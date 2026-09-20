import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {ProcessingError} from '../lib/processing/contracts';
import {failurePolicy,retryAfter} from '../lib/processing/failure-policy';
import {checkpointCall,databaseCheckpoints} from './checkpoints';
import {json} from '../lib/processing/engine';
// 14 arrivals / 1.271h, 5 Persian + 9 Arabic: 29.90 base requests/h.
// 50% burst/comparison headroom -> 45/h, 1080/day; dollar cap stays $1.
export const limits={hourRequests:45,dayRequests:1080,dayReservedUsd:1,requestBytes:600000,outputTokens:4096,jobIntervalMs:0} as const;

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
   let reservationId:string|undefined;
   const bytes=Buffer.byteLength(body,'utf8');
   await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20916012)`;
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT CURRENT_TIMESTAMP as now`;
    const nowMs=now.getTime();
    const rows=await tx.auditLog.findMany({where:{entityType:'ProviderBudget',entityId:'gemini',createdAt:{gt:new Date(nowMs-86400000)}},select:{id:true,action:true,metadata:true,createdAt:true}});
    const cooldown=Math.max(0,...rows.filter(r=>r.action==='PROVIDER_COOLDOWN').map(r=>Number((r.metadata as {until:number}).until)||0));
    if(cooldown>nowMs)throw new ProcessingError('PROVIDER_COOLDOWN',true,undefined,cooldown-nowMs);
    const reservations=accountedReservations(rows);
    const decision=budgetDecision(reservations,bytes,nowMs);
    if(!decision.allowed)throw new ProcessingError('PROVIDER_BUDGET_EXHAUSTED',true,undefined,budgetRetryDelay(reservations,bytes,nowMs));
    reservationId=(await tx.auditLog.create({data:{action:'PROVIDER_RESERVED',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Conservative input-byte/output-token budget; no credentials',metadata:json({usd:decision.reservedUsd,bytes,postId,key})}})).id;
   });
   try {
    networkAttempt=true;
    const response=await transport(url,init);
    if(!response.ok)throw new ProcessingError(`GEMINI_HTTP_${response.status}`,failurePolicy(`GEMINI_HTTP_${response.status}`,1).retryable,undefined,retryAfter(response.headers));
    const envelope=await response.json(),usd=observedCost(envelope);
    // Only a known successful HTTP response with complete usage releases its
    // conservative reservation. Unknown/failed requests retain their full cost.
    if(usd!==null&&reservationId)await db.auditLog.create({data:{action:'PROVIDER_USAGE_SETTLED',actor:'production-worker',entityType:'ProviderBudget',entityId:'gemini',message:'Known response usage; original reservation retained in audit',metadata:{key,reservationId,usd,postId}}});
    return envelope;
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
 const rows=await db.auditLog.findMany({where:{entityType:'ProviderBudget',entityId:'gemini',createdAt:{gt:new Date(Date.now()-86400000)}},select:{id:true,action:true,metadata:true,createdAt:true}});
 const now=Date.now(),reservations=accountedReservations(rows);
 const until=Math.max(0,...rows.filter(r=>r.action==='PROVIDER_COOLDOWN').map(r=>Number((r.metadata as {until:number}).until)||0));
 // Reserve room for one maximum-size call before taking ownership of a story.
 if(until>now)return until-now;
 return budgetRetryDelay(reservations,limits.requestBytes,now);
}
