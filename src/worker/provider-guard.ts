import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {ProcessingError} from '../lib/processing/contracts';
import {failurePolicy,retryAfter} from '../lib/processing/failure-policy';
import {checkpointCall,databaseCheckpoints} from './checkpoints';
import {json} from '../lib/processing/engine';
export const limits={hourRequests:12,dayRequests:48,dayReservedUsd:1,requestBytes:600000,outputTokens:4096,jobIntervalMs:60000} as const;
type Reservation={at:number;usd:number};
export function budgetRetryDelay(reservations:Reservation[],bytes:number,now:number){
 if(budgetDecision(reservations,bytes,now).allowed)return 0;
 const boundaries=[...new Set(reservations.flatMap(r=>[r.at+3600000,r.at+86400000]))].filter(t=>t>now).sort((a,b)=>a-b);
 const available=boundaries.find(t=>budgetDecision(reservations,bytes,t).allowed);
 return available===undefined?86400000:Math.max(1000,available-now);
}
export function budgetDecision(reservations:Reservation[],bytes:number,now:number){
 const cost=(bytes*0.25+limits.outputTokens*1.5)/1e6;
 const day=reservations.filter(r=>r.at>now-86400000),hour=day.filter(r=>r.at>now-3600000);
 const blocked=!Number.isFinite(bytes)||bytes<0||reservations.some(r=>!Number.isFinite(r.usd)||r.usd<0||!Number.isFinite(r.at))||bytes>limits.requestBytes||hour.length>=limits.hourRequests||day.length>=limits.dayRequests||day.reduce((s,r)=>s+r.usd,0)+cost>limits.dayReservedUsd;
 return {allowed:!blocked,reservedUsd:cost};
}
/** Durable reservation BEFORE network. Failed/ambiguous attempts are never
 * refunded. These conservative byte/token reservations bound spend on restart. */
export function guardedTransport(db:PrismaClient,postId:string,transport:typeof fetch=fetch):typeof fetch{
 const store=databaseCheckpoints(db,postId);
 return async(url,init)=>{
  const body=String(init?.body??'');
  let networkAttempt=false;
  const key=createHash('sha256').update(`native-gemini-request-v1:${String(url)}:${body}`).digest('hex');
  const envelope=await checkpointCall(store,key,async()=>{
   const bytes=Buffer.byteLength(body,'utf8');
   await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20916012)`;
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT CURRENT_TIMESTAMP as now`;
    const nowMs=now.getTime();
    const rows=await tx.auditLog.findMany({where:{entityType:'ProviderBudget',entityId:'gemini',createdAt:{gt:new Date(nowMs-86400000)}},select:{action:true,metadata:true,createdAt:true}});
    const cooldown=Math.max(0,...rows.filter(r=>r.action==='PROVIDER_COOLDOWN').map(r=>Number((r.metadata as {until:number}).until)||0));
    if(cooldown>nowMs)throw new ProcessingError('PROVIDER_COOLDOWN',true,undefined,cooldown-nowMs);
    const reservations=rows.filter(r=>r.action==='PROVIDER_RESERVED').map(r=>({at:r.createdAt.getTime(),usd:Number((r.metadata as {usd:number}).usd)}));
    const decision=budgetDecision(reservations,bytes,nowMs);
    if(!decision.allowed)throw new ProcessingError('PROVIDER_BUDGET_EXHAUSTED',true,undefined,budgetRetryDelay(reservations,bytes,nowMs));
    await tx.auditLog.create({data:{action:'PROVIDER_RESERVED',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Conservative input-byte/output-token budget; no credentials',metadata:json({usd:decision.reservedUsd,bytes,postId,key})}});
   });
   try {
    networkAttempt=true;
    const response=await transport(url,init);
    if(!response.ok)throw new ProcessingError(`GEMINI_HTTP_${response.status}`,failurePolicy(`GEMINI_HTTP_${response.status}`,1).retryable,undefined,retryAfter(response.headers));
    return await response.json();
   }catch(error){
    const safe=error instanceof ProcessingError?error:new ProcessingError('GEMINI_TRANSPORT_FAILED',true);
    if(failurePolicy(safe.code,1).providerFailure){
     const failures=await db.auditLog.count({where:{action:'PROVIDER_COOLDOWN',entityType:'ProviderBudget',entityId:'gemini',createdAt:{gt:new Date(Date.now()-3600000)}}});
     const delay=Math.max(Math.min(3600000,60000*2**Math.min(failures,6)),safe.retryAfterMs);
     await db.auditLog.create({data:{action:'PROVIDER_COOLDOWN',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Provider failure stops provider-dependent queue work',metadata:json({code:safe.code,until:Date.now()+delay})}});
    }
    throw safe;
   }
  });
  return Response.json(envelope,{headers:{'x-worker-checkpoint-replayed':networkAttempt?'false':'true'}});
 };
}
/** Admission delay does not claim a job or consume its finite retry attempts. */
export async function providerAdmissionDelay(db:PrismaClient){
 const rows=await db.auditLog.findMany({where:{entityType:'ProviderBudget',entityId:'gemini',createdAt:{gt:new Date(Date.now()-86400000)}},select:{action:true,metadata:true,createdAt:true}});
 const now=Date.now(),reservations=rows.filter(r=>r.action==='PROVIDER_RESERVED').map(r=>({at:r.createdAt.getTime(),usd:Number((r.metadata as {usd:number}).usd)}));
 const until=Math.max(0,...rows.filter(r=>r.action==='PROVIDER_COOLDOWN').map(r=>Number((r.metadata as {until:number}).until)||0));
 // Reserve room for one maximum-size call before taking ownership of a story.
 if(until>now||!budgetDecision(reservations,limits.requestBytes,now).allowed)return 60000;
 const latest=Math.max(0,...rows.filter(r=>r.action==='PROVIDER_JOB_ADMITTED').map(r=>r.createdAt.getTime()));
 return Math.max(0,limits.jobIntervalMs-(now-latest));
}
