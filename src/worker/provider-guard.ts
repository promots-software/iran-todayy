import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {ProcessingError} from '../lib/processing/contracts';
import {failurePolicy,retryAfter} from '../lib/processing/failure-policy';
import {checkpointCall,databaseCheckpoints} from './checkpoints';
import {json} from '../lib/processing/engine';
import {capacityDiagnostic,capacityRetryMs,capacityState} from './provider-capacity';
import {googleQuota,pacificDay,quotaDecision} from './provider-quota';
// Keep the existing application hourly/cost ceilings; these are NOT Google's
// quota. Provider RPD uses Pacific midnight; cost remains rolling 24 hours.
export const limits={hourRequests:45,dayRequests:googleQuota.rpd,dayReservedUsd:1,requestBytes:600000,outputTokens:4096,jobIntervalMs:0} as const;
export const geminiResource='generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

type BudgetRow={id?:string;action:string;metadata:unknown;createdAt:Date};
function quotaReservations(rows:BudgetRow[]){
 const settled=new Map<string,number>();
 for(const row of rows.filter(r=>r.action==='PROVIDER_USAGE_SETTLED')){
  const m=row.metadata as {reservationId?:string;inputTokens?:number};
  if(typeof m.reservationId==='string'&&Number.isSafeInteger(m.inputTokens)&&m.inputTokens!>=0)settled.set(m.reservationId,Math.max(settled.get(m.reservationId)??0,m.inputTokens!));
 }
 return rows.filter(r=>r.action==='PROVIDER_RESERVED').map(r=>{const m=r.metadata as {bytes?:number;inputTokens?:number};return {at:r.createdAt.getTime(),inputTokens:r.id&&settled.has(r.id)?settled.get(r.id)!:Number(m.inputTokens??m.bytes??googleQuota.inputTpm)};});
}
export function accountedReservations(rows:BudgetRow[]){
 const settled=new Map<string,number>();
 for(const row of rows.filter(r=>r.action==='PROVIDER_USAGE_SETTLED')){
  const m=row.metadata as {reservationId?:string;usd?:number};
  if(typeof m.reservationId==='string'&&typeof m.usd==='number'&&Number.isFinite(m.usd)&&m.usd>=0)settled.set(m.reservationId,Math.max(settled.get(m.reservationId)??0,m.usd));
 }
 return rows.filter(r=>r.action==='PROVIDER_RESERVED').map(r=>{const m=r.metadata as {usd:number};return {at:r.createdAt.getTime(),usd:r.id&&settled.has(r.id)?settled.get(r.id)!:Number(m.usd)};});
}
export function observedCost(envelope:unknown){
 const u=(envelope as {usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number;totalTokenCount?:number}})?.usageMetadata;
 const counts=[u?.promptTokenCount,u?.candidatesTokenCount,u?.thoughtsTokenCount??0];
 if(!counts.every(n=>Number.isSafeInteger(n)&&n!>=0)||!Number.isSafeInteger(u?.totalTokenCount)||u!.totalTokenCount!<counts.reduce<number>((s,n)=>s+n!,0))return null;
 // Count any additional reported tokens conservatively at the output price.
 return (u!.promptTokenCount!*0.25+(u!.totalTokenCount!-u!.promptTokenCount!)*1.5)/1e6;
}
type Reservation={at:number;usd:number};
export function budgetRetryDelay(reservations:Reservation[],bytes:number,now:number,outputTokens:number=limits.outputTokens){
 if(budgetDecision(reservations,bytes,now,outputTokens).allowed)return 0;
 const boundaries=[...new Set(reservations.flatMap(r=>[r.at+3600000,r.at+86400000]))].filter(t=>t>now).sort((a,b)=>a-b);
 const available=boundaries.find(t=>budgetDecision(reservations,bytes,t,outputTokens).allowed);
 return available===undefined?86400000:Math.max(1000,available-now);
}
export function budgetDecision(reservations:Reservation[],bytes:number,now:number,outputTokens:number=limits.outputTokens){
 const cost=(bytes*0.25+outputTokens*1.5)/1e6;
 const day=reservations.filter(r=>r.at>now-86400000),hour=day.filter(r=>r.at>now-3600000);
 const invalid=!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(outputTokens)||outputTokens<0||outputTokens>limits.outputTokens||reservations.some(r=>!Number.isFinite(r.usd)||r.usd<0||!Number.isFinite(r.at))||bytes>limits.requestBytes;
 const reason=invalid?'PROVIDER_INPUT_LIMIT':hour.length>=limits.hourRequests?'PROVIDER_HOURLY_WAIT':day.reduce((s,r)=>s+r.usd,0)+cost>limits.dayReservedUsd?'PROVIDER_COST_WAIT':null;
 return {allowed:reason===null,reservedUsd:cost,reason};
}
async function readCapacityRows(db:Pick<PrismaClient,'auditLog'>,now:number){
 return db.auditLog.findMany({where:{entityType:'ProviderBudget',entityId:'gemini',createdAt:{gt:new Date(Math.min(now-86400000,pacificDay(now).start)-1)}},select:{id:true,action:true,metadata:true,createdAt:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
}
export async function providerCapacitySnapshot(db:PrismaClient,now=Date.now()){
 const rows=await readCapacityRows(db,now),capacity=capacityState(rows,geminiResource,now),quotas=quotaDecision(quotaReservations(rows),1,now),reservations=accountedReservations(rows),budget=budgetDecision(reservations,1,now,0);
 const costUsed=reservations.filter(r=>r.at>now-86400000).reduce((s,r)=>s+r.usd,0);
 const reason=capacity.waitMs?'PROVIDER_CAPACITY_WAIT':quotas.reason??budget.reason??(costUsed>=limits.dayReservedUsd?'PROVIDER_COST_WAIT':null);
 const waitMs=Math.max(capacity.waitMs,quotas.waitMs,budget.allowed?0:budgetRetryDelay(reservations,1,now,0));
 const diagnostic=rows.filter(r=>r.action==='PROVIDER_HTTP_DIAGNOSTIC').at(-1)?.metadata??null;
 return {state:reason?'CAPACITY_WAIT':capacity.probe?'RECOVERY_PROBE':'AVAILABLE',reason,resource:geminiResource,waitMs,nextRequestAt:now+waitMs,quotas,limits:googleQuota,applicationHourLimit:limits.hourRequests,applicationHourUsed:reservations.filter(r=>r.at>now-3600000).length,costRolling24hUsd:reservations.filter(r=>r.at>now-86400000).reduce((s,r)=>s+r.usd,0),costCeilingUsd:limits.dayReservedUsd,diagnostic};
}
/** Diagnostic only; never put this before job claiming. */
export async function providerRequestDelay(db:PrismaClient){return (await providerCapacitySnapshot(db)).waitMs;}
/** Durable reservation BEFORE network. Failed/ambiguous attempts are never
 * refunded. These conservative byte/token reservations bound spend on restart. */
export function guardedTransport(db:PrismaClient,postId:string,transport:typeof fetch=fetch):typeof fetch{
 const store=databaseCheckpoints(db,postId);
 return async(url,init)=>{
  const body=String(init?.body??'');
  const endpoint=new URL(String(url));
  const resource=`${endpoint.hostname}${endpoint.pathname}`;
  let networkAttempt=false;
  const key=createHash('sha256').update(`native-gemini-request-v1:${String(url)}:${body}`).digest('hex');
  const envelope=await checkpointCall(store,key,async()=>{
   let reservationId:string|undefined,requestStartedAt=0;
   const bytes=Buffer.byteLength(body,'utf8');
   let outputTokens:number;
   try{outputTokens=Number(JSON.parse(body).generationConfig?.maxOutputTokens??limits.outputTokens);}catch{throw new ProcessingError('PROVIDER_INPUT_LIMIT');}
   await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20916012)`;
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() as now`;
    const nowMs=now.getTime();
    requestStartedAt=nowMs;
    const rows=await readCapacityRows(tx,nowMs);
    const capacity=capacityState(rows,resource,nowMs);
    if(capacity.waitMs)throw new ProcessingError('PROVIDER_CAPACITY_WAIT',true,undefined,capacity.waitMs);
    // UTF-8 request bytes conservatively bound input tokens; settled usage
    // replaces this estimate only after an unambiguous response. No countTokens call.
    const quota=quotaDecision(quotaReservations(rows),bytes,nowMs);
    if(quota.reason)throw new ProcessingError(quota.reason,quota.waitMs>0,undefined,quota.waitMs);
    const reservations=accountedReservations(rows);
    const decision=budgetDecision(reservations,bytes,nowMs,outputTokens);
    if(!decision.allowed)throw new ProcessingError(decision.reason!,decision.reason!=='PROVIDER_INPUT_LIMIT',undefined,budgetRetryDelay(reservations,bytes,nowMs,outputTokens));
    if(capacity.probe)await tx.auditLog.create({data:{createdAt:now,action:'PROVIDER_CAPACITY_PROBE',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'One bounded recovery request for this model resource',metadata:json({resource,until:nowMs+65000})}});
    reservationId=(await tx.auditLog.create({data:{createdAt:now,action:'PROVIDER_RESERVED',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Conservative actual-request budget; no credentials',metadata:json({usd:decision.reservedUsd,bytes,inputTokens:bytes,outputTokens,resource,postId,key})}})).id;
   });
   try {
    networkAttempt=true;
    const response=await transport(url,init);
    if(!response.ok){
     // Bounded error body; never persist raw text, request headers or secrets.
     const diagnostic=capacityDiagnostic(response.status,await readErrorBody(response),retryAfter(response.headers));
     const delay=Math.max(capacityRetryMs(diagnostic),diagnostic.quotas.some(q=>q.period==='DAY')?pacificDay(Date.now()).end-Date.now():0);
     await db.auditLog.create({data:{action:'PROVIDER_HTTP_DIAGNOSTIC',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Sanitized provider rejection; quota unknown unless explicitly reported',metadata:json({resource,postId,...diagnostic})}});
     if(failurePolicy(`GEMINI_HTTP_${response.status}`,1).providerFailure)await db.auditLog.create({data:{action:'PROVIDER_CAPACITY_BLOCKED',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Only this model network resource is unavailable; local and cached work continue',metadata:json({resource,code:`GEMINI_HTTP_${response.status}`,until:Date.now()+delay,diagnostic})}});
     throw new ProcessingError(`GEMINI_HTTP_${response.status}`,failurePolicy(`GEMINI_HTTP_${response.status}`,1).retryable,undefined,delay);
    }
    const envelope=await response.json(),usd=observedCost(envelope);
    // Only a known successful HTTP response with complete usage releases its
    // conservative reservation. Unknown/failed requests retain their full cost.
    if(usd!==null&&reservationId)await db.auditLog.create({data:{action:'PROVIDER_USAGE_SETTLED',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Known response usage; original reservation retained in audit',metadata:{key,reservationId,usd,postId,inputTokens:envelope.usageMetadata.promptTokenCount}}});
    await db.auditLog.create({data:{action:'PROVIDER_CAPACITY_HEALTHY',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Successful model response',metadata:{resource,requestStartedAt}}});
    return envelope;
   }catch(error){
    const safe=error instanceof ProcessingError?error:new ProcessingError('GEMINI_TRANSPORT_FAILED',true);
    if(safe.code==='GEMINI_TRANSPORT_FAILED'){
     await db.auditLog.create({data:{action:'PROVIDER_CAPACITY_BLOCKED',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Transport outcome unknown; no blind replay',metadata:json({resource,code:safe.code,until:Date.now()+60000})}});
    }
    throw safe;
   }
  });
  return Response.json(envelope,{headers:{'x-worker-checkpoint-replayed':networkAttempt?'false':'true'}});
 };
}
async function readErrorBody(response:Response):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)return null;
 const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>16384)return null;chunks.push(part.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{return null;}finally{await reader.cancel().catch(()=>{});}
}
