import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {lockEditorialPublication} from '../human-editorial-contract';
import {autoPolicySchema,type AutoPolicy} from './auto-policy';
import {automaticControlState} from './auto-control';
import {deliveryDiagnosticsSchema} from './delivery-diagnostics';

// 120s matches stale-send reconciliation and exceeds the 25s transport deadline.
// Second independent failure waits 5m. Three within 30m OR three without a
// confirmed successful send require an operator, even at very low traffic rates.
export const recoveryTiming={first:120_000,second:300_000,window:30*60_000,check:30_000,maxWait:15*60_000} as const;
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function databaseNow(tx:Prisma.TransactionClient){return (await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now;}
export function failureSchedule(policy:AutoPolicy,now:Date){
 const failureTimes=[...(policy.failureTimes??[]).filter(t=>now.getTime()-Date.parse(t)<recoveryTiming.window),now.toISOString()].slice(-3);
 const consecutiveFailures=Math.min(3,(policy.consecutiveFailures??0)+1);
 const count=Math.max(failureTimes.length,consecutiveFailures);
 return {failureTimes,consecutiveFailures,circuit:count>=3?'OPEN' as const:count===2?'BACKOFF' as const:'COOLDOWN' as const,delay:count===1?recoveryTiming.first:recoveryTiming.second};
}

/** Quarantine is an immutable sidecar audit. Neither receipt nor UNKNOWN changes. */
export async function isQuarantined(tx:Prisma.TransactionClient,id:string){
 const p=await tx.publication.findUniqueOrThrow({where:{id},include:{attempts:true}});
 const audit=await tx.auditLog.findUnique({where:{id:`delivery-quarantine:${id}`}});
 const m=audit?.metadata as Record<string,unknown>|null;
 return ['UNKNOWN','FAILED'].includes(p.status)&&m?.historicalOutcome===p.status&&p.attemptCount===1&&p.attempts.length===1&&p.attempts[0].attempt===1&&!!p.attempts[0].finishedAt&&!p.telegramMessageId&&!p.sentAt&&audit?.action==='PUBLICATION_QUARANTINED'&&m?.digest===p.idempotencyKey&&m.policyId===p.automaticPolicyId&&m.destination===p.destination&&m.receiptsHash===hash(p.attempts.map(a=>({id:a.id,result:a.result,finishedAt:a.finishedAt})))&&m.resultHash===hash(p.telegramResult);
}

export async function interruptAutomaticDelivery(db:PrismaClient,id:string){
 return db.$transaction(async tx=>{
  await lockEditorialPublication(tx);
  const settings=await tx.appSettings.findUniqueOrThrow({where:{id:1}});
  const parsed=autoPolicySchema.safeParse(settings.telegramAutoPolicy);if(!parsed.success)return;
  const policy=parsed.data;
  const p=await tx.publication.findUniqueOrThrow({where:{id},include:{attempts:true}});
  if(!p.automaticPolicyId||!['UNKNOWN','FAILED'].includes(p.status))return;
  if(await tx.auditLog.findUnique({where:{id:`delivery-interruption:${id}`}}))return;
  const now=await databaseNow(tx),diagnostic=deliveryDiagnosticsSchema.safeParse((await tx.auditLog.findUnique({where:{id:`delivery-diagnostic:${id}`}}))?.metadata);
  const a=p.attempts[0],receipt=a?.result as {digest?:string;outcome?:{status?:string}}|null;
  const durableOutcome=['UNKNOWN','FAILED'].includes(p.status)&&p.attemptCount===1&&p.attempts.length===1&&!!a.finishedAt&&receipt?.digest===p.idempotencyKey&&receipt.outcome?.status===p.status&&!p.telegramMessageId&&!p.sentAt;
  const transientRejection=p.status==='FAILED'&&p.error==='TELEGRAM_REJECTED_429'&&diagnostic.success&&!!diagnostic.data.retryAfterSeconds;
  if(durableOutcome&&(p.status==='UNKNOWN'||transientRejection))await tx.auditLog.create({data:{id:`delivery-quarantine:${id}`,actor:'automatic-telegram-worker',action:'PUBLICATION_QUARANTINED',entityType:'Publication',entityId:id,message:'Historical outcome preserved; no automatic resend',metadata:{historicalOutcome:p.status,digest:p.idempotencyKey,policyId:p.automaticPolicyId,destination:p.destination,receiptsHash:hash(p.attempts.map(a=>({id:a.id,result:a.result,finishedAt:a.finishedAt}))),resultHash:hash(p.telegramResult)}}});
  // A crash may occur after SENT commits but before the optional counter reset.
  // Durable successful delivery is authoritative over that cached counter.
  const lastFailure=policy.failureTimes?.at(-1);
  const successSince=lastFailure&&policy.consecutiveFailures?await tx.publication.findFirst({where:{automaticPolicyId:{not:null},destination:policy.destination,status:'SENT',sentAt:{gt:new Date(lastFailure)}},select:{id:true}}):null;
  const schedule=failureSchedule(successSince?{...policy,consecutiveFailures:0}:policy,now);
  const recoverable=durableOutcome&&diagnostic.success&&(transientRejection||(p.status==='UNKNOWN'&&['TIMEOUT','ABORTED','TRANSPORT_EXCEPTION','RESPONSE_PARSE_FAILED','UNEXPECTED_RESPONSE'].includes(diagnostic.data.errorCategory??'')));
  const delay=Math.max(schedule.delay,diagnostic.success?(diagnostic.data.retryAfterSeconds??0)*1000:0);
  // Never resurrect an operator-disabled, legacy-closed or CANARY policy.
  const canTransition=policy.state==='ACTIVE'||policy.state==='CANARY';
  const temporary=policy.state==='ACTIVE'&&recoverable&&schedule.circuit!=='OPEN'&&policy.id===p.automaticPolicyId;
  const reason=temporary?'TEMPORARY_RECOVERY':'SYSTEMIC_DELIVERY_FAILURE';
  const recovery={version:'telegram-recovery-v1' as const,publicationId:id,newsItemId:p.newsItemId,startedAt:now.toISOString(),nextCheckAt:new Date(now.getTime()+delay).toISOString(),expiresAt:new Date(now.getTime()+delay+recoveryTiming.maxWait).toISOString(),checks:0,...(diagnostic.success?{diagnostic:diagnostic.data}:{}),blocker:temporary?'COOLDOWN':recoverable?'REPEATED_DELIVERY_FAILURE':'UNPROVEN_OR_PERMANENT_DELIVERY_FAILURE',circuit:temporary?schedule.circuit:'OPEN' as const};
  if(canTransition)await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...policy,state:'CLOSED',reason,recovery,failureTimes:schedule.failureTimes,consecutiveFailures:schedule.consecutiveFailures}}});
  await tx.auditLog.create({data:{id:`delivery-interruption:${id}`,actor:'automatic-telegram-worker',action:'AUTOMATIC_DELIVERY_INTERRUPTED',entityType:'Publication',entityId:id,message:canTransition?reason:'POLICY_UNCHANGED',metadata:{policyId:policy.id,previousState:policy.state,newState:canTransition?'CLOSED':policy.state,timestamp:now.toISOString(),subsystem:'TELEGRAM',...(diagnostic.success?diagnostic.data:{}),...recovery,policyChanged:canTransition}}});
 },{timeout:30000});
}

/** No sends. Probe only bot identity and posting permission for the exact target. */
export async function probeRecoveryReadiness(env:Record<string,string|undefined>,transport:typeof fetch=fetch):Promise<string|null>{
 const token=env.TELEGRAM_BOT_TOKEN,destination=env.TELEGRAM_CHAT_ID;
 if(!token||!/^\d+:[A-Za-z0-9_-]+$/.test(token)||!destination||!/^-[1-9]\d*$/.test(destination))return 'TELEGRAM_CONFIG_INVALID';
 try{
  const request=async(method:string,body:Record<string,unknown>)=>{
   const r=await transport(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!r.ok)return null;const j=await r.json();return j.ok===true?j.result:null;
  };
  const me=await request('getMe',{});if(!me?.is_bot||!Number.isSafeInteger(me.id)||String(me.id)!==token.split(':')[0])return 'TELEGRAM_IDENTITY_UNVERIFIED';
  const member=await request('getChatMember',{chat_id:destination,user_id:me.id});
  return member?.user?.id===me.id&&member.status==='administrator'&&member.can_post_messages===true?null:'TELEGRAM_POST_PERMISSION_UNVERIFIED';
 }catch{return 'TELEGRAM_READINESS_UNAVAILABLE';}
}

async function readinessBlocker(tx:Prisma.TransactionClient,policy:AutoPolicy,paused:boolean,env:Record<string,string|undefined>,now:Date){
 if(paused)return 'EMERGENCY_HOLD';
 if(env.AUTO_PUBLISH!=='true'||env.SHADOW_MODE!=='false'||env.REQUIRE_APPROVAL!=='true'||env.TELEGRAM_PUBLISH_ENABLED!=='true')return 'DELIVERY_CAPABILITY_UNAVAILABLE';
 if(env.TELEGRAM_CHAT_ID!==policy.destination)return 'DESTINATION_MISMATCH';
 const state=automaticControlState(policy,paused,await tx.workerHeartbeat.findUnique({where:{id:'telegram-publisher-worker'}}),now);
 if(!state.capabilities||!state.observed)return state.reason;
 const worker=await tx.workerHeartbeat.findUnique({where:{id:'telegram-production-worker'}});
 const m=worker?.metadata as {telegramReady?:boolean}|null;
 if(!worker||worker.lastError||worker.state==='ERROR'||now.getTime()-worker.lastSeenAt.getTime()>=45000||now<worker.lastSeenAt||m?.telegramReady!==true)return 'WORKER_UNAVAILABLE';
 const pending=await tx.publication.findMany({where:{automaticPolicyId:{not:null},status:{in:['SENDING','UNKNOWN','FAILED']}},select:{id:true,status:true}});
 for(const p of pending)if(!['UNKNOWN','FAILED'].includes(p.status)||!await isQuarantined(tx,p.id))return 'UNRESOLVED_DELIVERY';
 return null;
}

/** Durable probe lease, network outside transaction, then CAS+lock+fresh checks. */
export async function recoverAutomaticPolicy(db:PrismaClient,env:Record<string,string|undefined>,probe:()=>Promise<string|null>=()=>probeRecoveryReadiness(env)){
 const permit=await db.$transaction(async tx=>{
  await lockEditorialPublication(tx);const s=await tx.appSettings.findUniqueOrThrow({where:{id:1}}),parsed=autoPolicySchema.safeParse(s.telegramAutoPolicy);
  if(!parsed.success)return null;const p=parsed.data,r=p.recovery;
  if(p.state!=='CLOSED'||p.reason!=='TEMPORARY_RECOVERY'||!r||r.circuit==='OPEN'||s.publishingPaused)return null;
  const now=await databaseNow(tx);if(now<new Date(r.nextCheckAt))return null;
  const blocker=s.publishingMode!=='REQUIRE_APPROVAL'?'LEGACY_POLICY_MISMATCH':await readinessBlocker(tx,p,s.publishingPaused,env,now);
  const expired=!!blocker&&r.checks>=3&&now>=new Date(r.expiresAt),next={...r,checks:r.checks+1,nextCheckAt:new Date(now.getTime()+recoveryTiming.check).toISOString(),blocker:blocker??'READINESS_CHECK',circuit:expired?'OPEN' as const:r.circuit};
  await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p,recovery:next,...(expired?{reason:'SYSTEMIC_DELIVERY_FAILURE'}:{})}}});
  await tx.auditLog.create({data:{actor:'automatic-telegram-worker',action:expired?'AUTOMATIC_RECOVERY_EXHAUSTED':'AUTOMATIC_RECOVERY_CHECK',entityType:'AppSettings',entityId:'1',message:expired?'RECOVERY_DEADLINE_EXCEEDED':next.blocker,metadata:{policyId:p.id,...next}}});
  return blocker||expired?null:{policy:p,checks:next.checks};
 },{timeout:30000});
 if(!permit)return false;
 const result=await probe().catch(()=>'TELEGRAM_READINESS_UNAVAILABLE'); // Callback returns allowlisted codes, never an exception text.
 return db.$transaction(async tx=>{
  await lockEditorialPublication(tx);const s=await tx.appSettings.findUniqueOrThrow({where:{id:1}}),parsed=autoPolicySchema.safeParse(s.telegramAutoPolicy);
  if(!parsed.success)return false;const p=parsed.data,r=p.recovery;
  if(p.id!==permit.policy.id||p.state!=='CLOSED'||p.reason!=='TEMPORARY_RECOVERY'||!r||r.checks!==permit.checks)return false;
  const now=await databaseNow(tx);if(now>=new Date(r.nextCheckAt))return false;const blocker=await readinessBlocker(tx,p,s.publishingPaused,env,now);
  if(result||blocker){
   const safeResult=['TELEGRAM_CONFIG_INVALID','TELEGRAM_IDENTITY_UNVERIFIED','TELEGRAM_POST_PERMISSION_UNVERIFIED','TELEGRAM_READINESS_UNAVAILABLE'].includes(result??'')?result!:'TELEGRAM_READINESS_UNAVAILABLE';
   const failed=blocker??safeResult,expired=r.checks>=3&&now>=new Date(r.expiresAt);
   const next={...r,blocker:failed,circuit:expired?'OPEN' as const:r.circuit};
   await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p,recovery:next,...(expired?{reason:'SYSTEMIC_DELIVERY_FAILURE'}:{})}}});
   await tx.auditLog.create({data:{actor:'automatic-telegram-worker',action:expired?'AUTOMATIC_RECOVERY_EXHAUSTED':'AUTOMATIC_RECOVERY_CHECK_RESULT',entityType:'AppSettings',entityId:'1',message:failed,metadata:{policyId:p.id,...next}}});return false;
  }
  const {recovery:_recovery,reason:_reason,...retained}=p;void _recovery;void _reason;
  const id=randomUUID(),notBefore=now.toISOString();
  await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...retained,id,state:'ACTIVE',notBefore}}});
  await tx.auditLog.create({data:{actor:'automatic-telegram-worker',action:'AUTOMATIC_DELIVERY_RECOVERED',entityType:'AppSettings',entityId:'1',message:'Fresh database boundary; outage stories excluded',metadata:{previousPolicyId:p.id,policyId:id,previousState:'CLOSED',newState:'ACTIVE',publicationId:r.publicationId,newsItemId:r.newsItemId,notBefore,recoveryChecks:r.checks,circuit:'CLOSED'}}});
  return true;
 },{timeout:30000});
}

export async function recordAutomaticSuccess(db:PrismaClient,policyId:string){
 await db.$transaction(async tx=>{await lockEditorialPublication(tx);const s=await tx.appSettings.findUniqueOrThrow({where:{id:1}}),p=autoPolicySchema.safeParse(s.telegramAutoPolicy);if(p.success&&p.data.id===policyId&&p.data.consecutiveFailures)await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p.data,consecutiveFailures:0}}});});
}
