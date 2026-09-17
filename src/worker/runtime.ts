import {setTimeout as sleep} from 'node:timers/promises';
import type {PrismaClient} from '@prisma/client';
import {ProcessingError} from '../lib/processing/contracts';
import {json} from '../lib/processing/engine';

export const workerId = 'telegram-production-worker';
export const heartbeatMs = 15000;
export const leaseMs = 90000;
export function assertWorkerSafety(env: Record<string,string|undefined> = process.env) {
  if (env.SHADOW_MODE !== 'true') throw new ProcessingError('SHADOW_MODE_REQUIRED');
  if (env.REQUIRE_APPROVAL !== 'true') throw new ProcessingError('REQUIRE_APPROVAL_REQUIRED');
  if (env.AUTO_PUBLISH !== 'false' || env.TELEGRAM_PUBLISH_ENABLED !== 'false') throw new ProcessingError('PUBLISHING_MUST_BE_DISABLED');
}
export function workerConfig(env: Record<string,string|undefined> = process.env) {
  assertWorkerSafety(env);
  for (const name of ['DATABASE_URL','TELEGRAM_API_ID','TELEGRAM_API_HASH','TELEGRAM_SESSION','GEMINI_API_KEY']) {
    if (!env[name] || /[\s\x00-\x1f\x7f]/.test(env[name]!)) throw new ProcessingError(`${name}_REQUIRED`);
  }
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ProcessingError('WORKER_PORT_INVALID');
  let url: URL;
  try { url = new URL(env.DATABASE_URL!); } catch { throw new ProcessingError('DATABASE_URL_INVALID'); }
  if (!['postgres:','postgresql:'].includes(url.protocol)) throw new ProcessingError('DATABASE_URL_INVALID');
  // Bounded pool/waits, including Neon wake-up; never print this URL.
  url.searchParams.set('connection_limit','4');
  url.searchParams.set('connect_timeout','15');
  url.searchParams.set('pool_timeout','15');
  url.searchParams.set('socket_timeout','30');
  return {databaseUrl:url.href, geminiKey:env.GEMINI_API_KEY!, port};
}
export function safeWorkerError(error: unknown) {
  // ProcessingError codes are authored by this application, never raw RPC/DB text.
  return error instanceof ProcessingError && /^[A-Z][A-Z0-9_]{0,100}$/.test(error.code) ? error.code : 'WORKER_DEPENDENCY_UNAVAILABLE';
}
export class TelegramStartupError extends ProcessingError {
  constructor(code:string,readonly retryAfterMs=0) {super(code,code==='TELEGRAM_CONNECT_FAILED'||code==='TELEGRAM_FLOOD_WAIT');}
}
/** checkAuthorization() swallows network errors as false. Probe the same
 * read-only RPC directly so a temporary disconnect never looks like logout. */
export async function probeAuthorization(probe:()=>Promise<unknown>) {
  try {await probe();} catch(error) {
    const rpc=typeof error==='object' && error!==null && 'errorMessage' in error ? error.errorMessage : null;
    if(['AUTH_KEY_UNREGISTERED','AUTH_KEY_INVALID','SESSION_REVOKED','SESSION_EXPIRED','USER_DEACTIVATED','USER_DEACTIVATED_BAN'].includes(String(rpc)))throw new TelegramStartupError('TELEGRAM_AUTHORIZATION_REQUIRED');
    if(rpc==='AUTH_KEY_DUPLICATED')throw new TelegramStartupError('TELEGRAM_SESSION_CONFLICT');
    const seconds=typeof error==='object' && error!==null && 'seconds' in error ? Number(error.seconds) : 0;
    if(Number.isSafeInteger(seconds)&&seconds>0)throw new TelegramStartupError('TELEGRAM_FLOOD_WAIT',(seconds+1)*1000);
    throw new TelegramStartupError('TELEGRAM_CONNECT_FAILED');
  }
}
export function backoff(attempt: number, random = Math.random) {
  return Math.round(Math.min(300000,1000 * 2 ** Math.min(9,Math.max(0,attempt-1))) * (0.8 + random()*0.2));
}
export async function pause(ms:number, signal:AbortSignal) {
  try { await sleep(ms,undefined,{signal}); } catch { signal.throwIfAborted(); }
}
export async function deadline<T>(work:Promise<T>, signal:AbortSignal, ms:number):Promise<T> {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal,controller.signal]);
  try {
    return await Promise.race([work, sleep(ms,undefined,{signal:combined}).then(()=>{throw new ProcessingError('WORKER_OPERATION_TIMEOUT',true);})]);
  } finally { controller.abort(); }
}
/** Abort and drain the previous operation before its caller can reconnect or
 * start another poll. Merely racing a timeout leaves work running in parallel. */
export async function drainedDeadline<T>(work:(signal:AbortSignal)=>Promise<T>,cancel:()=>Promise<void>,signal:AbortSignal,ms:number,drainMs=30000):Promise<T> {
  const controller=new AbortController();
  const pending=work(AbortSignal.any([signal,controller.signal]));
  try {return await deadline(pending,signal,ms);} catch(error) {
    controller.abort();
    try {
      await deadline(cancel(),new AbortController().signal,drainMs);
      await deadline(pending.catch(()=>{}),new AbortController().signal,drainMs);
    } catch {throw new ProcessingError('WORKER_DRAIN_FAILED');}
    throw error;
  } finally {controller.abort();}
}
// Database-clock lease in the existing heartbeat row; no schema, filesystem or
// PostgreSQL session-lock dependency. Standby never connects the Telegram session.
export async function acquireLease(db:PrismaClient, runId:string) {
  const rows = await db.$queryRaw<{id:string}[]>`
    INSERT INTO "WorkerHeartbeat" (id,state,phase,"startedAt","lastSeenAt","intervalMs",metadata)
    VALUES (${workerId},'STARTING','PROCESSING',timezone('UTC',CURRENT_TIMESTAMP),timezone('UTC',CURRENT_TIMESTAMP),${heartbeatMs},${JSON.stringify({runId})}::jsonb)
    ON CONFLICT (id) DO UPDATE SET state='STARTING',"startedAt"=timezone('UTC',CURRENT_TIMESTAMP),
      "lastSeenAt"=timezone('UTC',CURRENT_TIMESTAMP),metadata=EXCLUDED.metadata,"lastError"=NULL
    WHERE "WorkerHeartbeat".state='STOPPED' OR "WorkerHeartbeat"."lastSeenAt" < timezone('UTC',CURRENT_TIMESTAMP) - (${leaseMs} * INTERVAL '1 millisecond')
    RETURNING id`;
  return rows.length === 1;
}
export async function renewLease(db:PrismaClient, runId:string, state:'IDLE'|'BUSY'|'ERROR', metadata:Record<string,unknown>) {
  const count = await db.$executeRaw`
    UPDATE "WorkerHeartbeat" SET state=${state}::"WorkerState","lastSeenAt"=timezone('UTC',CURRENT_TIMESTAMP),
      metadata=${JSON.stringify({...metadata,runId})}::jsonb,"lastError"=NULL
    WHERE id=${workerId} AND metadata->>'runId'=${runId}
      AND "lastSeenAt" > timezone('UTC',CURRENT_TIMESTAMP) - (${leaseMs} * INTERVAL '1 millisecond')`;
  if (count !== 1) throw new ProcessingError('WORKER_LEASE_LOST');
}
export async function releaseLease(db:PrismaClient, runId:string) {
  await db.workerHeartbeat.updateMany({where:{id:workerId,metadata:{path:['runId'],equals:runId}},data:{state:'STOPPED',lastSeenAt:new Date(),metadata:json({runId,externalPublishingEnabled:false})}});
}
export function healthStatus(lastDatabaseCheck:number, stopping:boolean, now=Date.now()) {
  return !stopping && lastDatabaseCheck > 0 && now-lastDatabaseCheck < 60000 ? 200 : 503;
}
