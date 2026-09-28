import {readBudgetSummary,summaryQuota} from './provider-budget-summary';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {ProcessingError} from '../lib/processing/contracts';
import {failurePolicy,retryAfter} from '../lib/processing/failure-policy';
import {checkpointCall,databaseCheckpoints} from './checkpoints';
import {json} from '../lib/processing/engine';
import {capacityDiagnostic,capacityRetryMs,capacityState} from './provider-capacity';
import {googleQuota,pacificDay} from './provider-quota';
import {checkpointAliases,type CheckpointRequestInit} from '../lib/processing/gemini-request';
import {geminiCostPolicy,transientBackoff} from './cost-config';
// Provider RPM/TPM/RPD supersede the old workload-derived 45/hour gate.
// Cost uses rolling 24 hours; provider RPD uses Pacific midnight.
export const limits={hourRequests:null,dayRequests:googleQuota.rpd,dayReservedUsd:geminiCostPolicy.hard,requestBytes:600000,outputTokens:4096,jobIntervalMs:0} as const;
export const geminiResource='generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

type BudgetRow={id?:string;action:string;metadata:unknown;createdAt:Date};
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
export function budgetRetryDelay(reservations:Reservation[],bytes:number,now:number,outputTokens:number=limits.outputTokens,outputCeiling:number=limits.outputTokens){
 if(budgetDecision(reservations,bytes,now,outputTokens,outputCeiling).allowed)return 0;
 const boundaries=[...new Set(reservations.map(r=>r.at+86400000))].filter(t=>t>now).sort((a,b)=>a-b);
 const available=boundaries.find(t=>budgetDecision(reservations,bytes,t,outputTokens,outputCeiling).allowed);
 return available===undefined?86400000:Math.max(1000,available-now);
}
export function budgetDecision(reservations:Reservation[],bytes:number,now:number,outputTokens:number=limits.outputTokens,outputCeiling:number=limits.outputTokens){
 const cost=(bytes*0.25+outputTokens*1.5)/1e6;
 const day=reservations.filter(r=>r.at>now-86400000);
 const invalid=!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(outputTokens)||outputTokens<0||outputTokens>outputCeiling||![4096,8192].includes(outputCeiling)||reservations.some(r=>!Number.isFinite(r.usd)||r.usd<0||!Number.isFinite(r.at))||bytes>limits.requestBytes;
 const reason=invalid?'PROVIDER_INPUT_LIMIT':day.reduce((s,r)=>s+r.usd,0)+cost>limits.dayReservedUsd?'PROVIDER_COST_WAIT':null;
 return {allowed:reason===null,reservedUsd:cost,reason};
}
export function costTelemetry(rows:BudgetRow[],now:number){
 const active=rows.filter(r=>r.createdAt.getTime()>now-86400000);
 const settledIds=new Set(rows.filter(r=>r.action==='PROVIDER_USAGE_SETTLED').map(r=>(r.metadata as {reservationId?:string}).reservationId));
 const reservations=accountedReservations(rows).filter(r=>r.at>now-86400000);
 const accounted=reservations.reduce((sum,r)=>sum+r.usd,0);
 const outstanding=active.filter(r=>r.action==='PROVIDER_RESERVED'&&!settledIds.has(r.id)).reduce((sum,r)=>sum+Number((r.metadata as {usd:number}).usd),0);
 return {accountedUsd:accounted,measuredUsd:accounted-outstanding,outstandingReservedUsd:outstanding,warningUsd:geminiCostPolicy.warning,hardLimitUsd:limits.dayReservedUsd,remainingUsd:Math.max(0,limits.dayReservedUsd-accounted),warning:accounted>=geminiCostPolicy.warning,circuit:accounted>=limits.dayReservedUsd?'OPEN':'CLOSED',maxTransientRetries:geminiCostPolicy.retries};
}
export async function providerCapacitySnapshot(db:PrismaClient,now=Date.now()){
 const summary=await readBudgetSummary(db,now,geminiResource,.25/1e6,1,limits.dayReservedUsd),capacity=capacityState(summary.capacityRows,geminiResource,now),quotas=summaryQuota(summary,1,now);
 const costUsed=summary.accountedUsd,budgetReason=summary.invalidCost?'PROVIDER_INPUT_LIMIT':costUsed+.25/1e6>limits.dayReservedUsd?'PROVIDER_COST_WAIT':null;
 const reason=capacity.waitMs?'PROVIDER_CAPACITY_WAIT':quotas.reason??budgetReason??(costUsed>=limits.dayReservedUsd?'PROVIDER_COST_WAIT':null);
 const waitMs=Math.max(capacity.waitMs,quotas.waitMs,budgetReason?summary.budgetWaitMs:0);
 const cost={accountedUsd:costUsed,measuredUsd:costUsed-summary.outstandingUsd,outstandingReservedUsd:summary.outstandingUsd,warningUsd:geminiCostPolicy.warning,hardLimitUsd:limits.dayReservedUsd,remainingUsd:Math.max(0,limits.dayReservedUsd-costUsed),warning:costUsed>=geminiCostPolicy.warning,circuit:costUsed>=limits.dayReservedUsd?'OPEN':'CLOSED',maxTransientRetries:geminiCostPolicy.retries};
 const costWaitJobs=await db.processingJob.count({where:{status:'RETRY',lastError:'PROVIDER_COST_WAIT'}});
 return {cost,costWaitJobs,transientFailures24h:summary.transientFailures24h,observedAt:now,state:reason?'CAPACITY_WAIT':capacity.probe?'RECOVERY_PROBE':'AVAILABLE',reason,resource:geminiResource,waitMs,nextRequestAt:now+waitMs,quotas,limits:googleQuota,applicationHourLimit:limits.hourRequests,applicationHourUsed:summary.hourUsed,costRolling24hUsd:costUsed,costCeilingUsd:limits.dayReservedUsd,diagnostic:summary.diagnostic};
}
/** Reconsider obsolete cost waits only after a fresh, healthy capacity snapshot.
 * This is permission to claim ONE job, never permission to call the provider.
 * The atomic actual-request guard remains authoritative. A job updated after
 * this snapshot cannot churn against the same observation. */
export function costWaitRecheckBefore(snapshot:Awaited<ReturnType<typeof providerCapacitySnapshot>>|null,now=Date.now()){
 if(!snapshot||snapshot.state!=='AVAILABLE'||snapshot.quotas.reason||snapshot.observedAt>now||now-snapshot.observedAt>60000)return undefined;
 const maximumReservation=(limits.requestBytes*.25+8192*1.5)/1e6;
 if(snapshot.costRolling24hUsd+maximumReservation>limits.dayReservedUsd)return undefined;
 // claimJob compares this with persisted updatedAt under its row lock. A fresh
 // monitor tick cannot churn the same early cost retry; restarts retain the bound.
 return new Date(snapshot.observedAt-300000);
}
/** Diagnostic only; never put this before job claiming. */
export async function providerRequestDelay(db:PrismaClient){return (await providerCapacitySnapshot(db)).waitMs;}
/** Durable reservation BEFORE network. Failed/ambiguous attempts are never
 * refunded. These conservative byte/token reservations bound spend on restart. */
export function guardedTransport(db:PrismaClient,postId:string,transport:typeof fetch=fetch):typeof fetch{
 const store=databaseCheckpoints(db,postId);
 return async(url,init)=>{
  const body=String(init?.body??'');
  const {[checkpointAliases]:aliases=[],...networkInit}=(init as CheckpointRequestInit|undefined)??{};
  const endpoint=new URL(String(url));
  const resource=`${endpoint.hostname}${endpoint.pathname}`;
  let networkAttempt=false;
  const key=createHash('sha256').update(`native-gemini-request-v1:${String(url)}:${body}`).digest('hex');
  const envelope=await checkpointCall(store,key,async()=>{
   // Exact former serialization of the SAME contract/input. Replay still flows
   // through all existing validators. A pending legacy request is ambiguous,
   // never an excuse to issue the shortened request as a new paid call.
   for(const priorBody of aliases){
    const priorKey=createHash('sha256').update(`native-gemini-request-v1:${String(url)}:${priorBody}`).digest('hex');
    if(priorKey===key)continue;
    const prior=await store.load(priorKey);
    if(prior&&'output' in prior)return prior.output;
    if(prior)throw new ProcessingError('PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW');
   }
   let reservationId:string|undefined,requestStartedAt=0,operationAttempt=0;
   const bytes=Buffer.byteLength(body,'utf8');
   let outputTokens:number,outputCeiling:number=limits.outputTokens;
   try{const payload=JSON.parse(body);outputTokens=Number(payload.generationConfig?.maxOutputTokens??limits.outputTokens);
    const input=JSON.parse(payload.contents?.[0]?.parts?.[0]?.text??'{}');
    if(input.version==='proposition-support-v4.4'&&payload.generationConfig?.thinkingConfig?.thinkingLevel==='high'&&payload.generationConfig?.candidateCount===1)outputCeiling=8192;
   }catch{throw new ProcessingError('PROVIDER_INPUT_LIMIT');}
   await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20916012)`;
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() as now`;
    const nowMs=now.getTime();
    requestStartedAt=nowMs;
    // Lifetime count for this exact operation survives worker restarts and rolling windows.
    operationAttempt=await tx.auditLog.count({where:{action:'PROVIDER_RESERVED',entityType:'ProviderBudget',entityId:'gemini',AND:[{metadata:{path:['postId'],equals:postId}},{metadata:{path:['key'],equals:key}}]}});
    if(operationAttempt>=1+geminiCostPolicy.retries)throw new ProcessingError('PROVIDER_RETRY_EXHAUSTED');
    operationAttempt++;
    const inputCheck=budgetDecision([],bytes,nowMs,outputTokens,outputCeiling);
    if(!inputCheck.allowed)throw new ProcessingError(inputCheck.reason!);
    const summary=await readBudgetSummary(tx,nowMs,resource,inputCheck.reservedUsd,bytes,limits.dayReservedUsd);
    const capacity=capacityState(summary.capacityRows,resource,nowMs);
    if(capacity.waitMs)throw new ProcessingError('PROVIDER_CAPACITY_WAIT',true,undefined,capacity.waitMs);
    // UTF-8 request bytes conservatively bound input tokens; settled usage
    // replaces this estimate only after an unambiguous response. No countTokens call.
    const quota=summaryQuota(summary,bytes,nowMs);
    if(quota.reason)throw new ProcessingError(quota.reason,quota.waitMs>0,undefined,quota.waitMs);
    const decision={...inputCheck,reason:summary.invalidCost?'PROVIDER_INPUT_LIMIT':summary.accountedUsd+inputCheck.reservedUsd>limits.dayReservedUsd?'PROVIDER_COST_WAIT':null};
    if(decision.reason)throw new ProcessingError(decision.reason,decision.reason!=='PROVIDER_INPUT_LIMIT',undefined,summary.budgetWaitMs);
    if(capacity.probe)await tx.auditLog.create({data:{createdAt:now,action:'PROVIDER_CAPACITY_PROBE',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'One bounded recovery request for this model resource',metadata:json({resource,until:nowMs+65000})}});
    reservationId=(await tx.auditLog.create({data:{createdAt:now,action:'PROVIDER_RESERVED',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Conservative actual-request budget; no credentials',metadata:json({usd:decision.reservedUsd,bytes,inputTokens:bytes,outputTokens,resource,postId,key,operationAttempt})}})).id;
   });
   try {
    networkAttempt=true;
    const response=await transport(url,networkInit);
    if(!response.ok){
     // Bounded error body; never persist raw text, request headers or secrets.
     const diagnostic=capacityDiagnostic(response.status,await readErrorBody(response),retryAfter(response.headers));
     const delay=transientBackoff(operationAttempt,Math.max(capacityRetryMs(diagnostic),diagnostic.quotas.some(q=>q.period==='DAY')?pacificDay(Date.now()).end-Date.now():0));
     await db.auditLog.create({data:{action:'PROVIDER_HTTP_DIAGNOSTIC',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Sanitized provider rejection; quota unknown unless explicitly reported',metadata:json({resource,postId,key,operationAttempt,...diagnostic})}});
     if(failurePolicy(`GEMINI_HTTP_${response.status}`,1).providerFailure)await db.auditLog.create({data:{action:'PROVIDER_CAPACITY_BLOCKED',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Only this model network resource is unavailable; local and cached work continue',metadata:json({resource,code:`GEMINI_HTTP_${response.status}`,until:Date.now()+delay,diagnostic})}});
     if(failurePolicy(`GEMINI_HTTP_${response.status}`,1).providerFailure)throw new ProcessingError(operationAttempt>=1+geminiCostPolicy.retries?'PROVIDER_RETRY_EXHAUSTED':'PROVIDER_TRANSIENT_WAIT',operationAttempt<1+geminiCostPolicy.retries,undefined,operationAttempt>=1+geminiCostPolicy.retries?0:delay);
     throw new ProcessingError(`GEMINI_HTTP_${response.status}`,false,undefined,delay);
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
