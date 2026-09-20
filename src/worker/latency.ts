import type {PrismaClient} from '@prisma/client';
import {providerWaitCodes} from '../lib/processing/failure-policy';

// Agreed operational targets, never ingestion throughput caps.
export function latencyTargets(env:NodeJS.ProcessEnv=process.env){
 const value=(key:string,fallback:number)=>{const n=Number(env[key]);return Number.isFinite(n)&&n>0?n:fallback;};
 return {ingestMs:value('SLO_INGEST_MS',60000),queueMs:value('SLO_QUEUE_MS',15000),processingMs:value('SLO_PROCESSING_MS',120000),readyMs:value('SLO_READY_MS',180000)};
}
export function distribution(values:number[]){
 const a=values.filter(x=>Number.isFinite(x)&&x>=0).sort((a,b)=>a-b);
 return {count:a.length,p50Ms:a[Math.floor(a.length*.5)]??null,p95Ms:a[Math.min(a.length-1,Math.floor(a.length*.95))]??null,maxMs:a.at(-1)??null};
}
export function latencyAlerts(metrics:{ingestMs:number|null;oldestEligibleMs:number|null;oldestRunningMs:number|null;readyMs:number|null},targets=latencyTargets()){
 return [metrics.ingestMs!==null&&metrics.ingestMs>targets.ingestMs?'INGEST_LATENCY':null,metrics.oldestEligibleMs!==null&&metrics.oldestEligibleMs>targets.queueMs?'QUEUE_LATENCY':null,metrics.oldestRunningMs!==null&&metrics.oldestRunningMs>targets.processingMs?'PROCESSING_LATENCY':null,metrics.readyMs!==null&&metrics.readyMs>targets.readyMs?'REVIEW_LATENCY':null].filter((s):s is string=>!!s);
}
export async function latencySnapshot(db:PrismaClient,now=new Date()){
 const since=new Date(now.getTime()-3600000);
 const scope={source:{platform:'TELEGRAM' as const,enabled:true,deletedAt:null}};
 const rows=await db.sourcePost.findMany({where:{...scope,ingestedAt:{gte:since}},orderBy:{ingestedAt:'desc'},take:1000,select:{sourcePublishedAt:true,ingestedAt:true,processingStartedAt:true,processingEndedAt:true,status:true,error:true}});
 const counts=await db.processingJob.groupBy({by:['status'],where:{sourcePost:scope},_count:true});
 const eligibleWhere={status:{in:['PENDING','RETRY'] as ('PENDING'|'RETRY')[]},stage:'PROCESS_V1',availableAt:{lte:now},sourcePost:{...scope,status:{in:['INGESTED','FAILED'] as ('INGESTED'|'FAILED')[]}},attemptCount:{lt:db.processingJob.fields.maxAttempts}};
 const eligible=await db.processingJob.findFirst({where:eligibleWhere,orderBy:{createdAt:'asc'},select:{createdAt:true}});
 const due=await db.processingJob.findFirst({where:eligibleWhere,orderBy:{availableAt:'asc'},select:{availableAt:true}});
 const running=await db.processingJob.findFirst({where:{status:'RUNNING',sourcePost:scope},orderBy:{lockedAt:'asc'},select:{lockedAt:true}});
 const waitingWhere={status:'RETRY' as const,lastError:{in:providerWaitCodes},sourcePost:scope};
 const providerWaiting=await db.processingJob.count({where:waitingWhere});
 const oldestWait=await db.processingJob.findFirst({where:waitingWhere,orderBy:{updatedAt:'asc'},select:{updatedAt:true}});
 const attempts=await db.auditLog.findMany({where:{action:'PROCESSING_ATTEMPT_FINISHED',createdAt:{gte:since}},select:{metadata:true}});
 const activeDuration=distribution(attempts.map(a=>Number((a.metadata as {activeMs?:number})?.activeMs)));
 const eligibleQueueWait=distribution(attempts.map(a=>Number((a.metadata as {eligibleWaitMs?:number})?.eligibleWaitMs)));
 const fresh=rows.filter(p=>p.sourcePublishedAt>=since);
 const ingestion=distribution(fresh.map(p=>p.ingestedAt.getTime()-p.sourcePublishedAt.getTime()));
 const queue=distribution(rows.flatMap(p=>p.processingStartedAt?[p.processingStartedAt.getTime()-p.ingestedAt.getTime()]:[]));
 const completion=distribution(rows.flatMap(p=>p.processingStartedAt&&p.processingEndedAt?[p.processingEndedAt.getTime()-p.processingStartedAt.getTime()]:[]));
 const ready=distribution(fresh.filter(p=>p.processingEndedAt&&!p.error&&['NEEDS_REVIEW','PENDING_APPROVAL'].includes(p.status)).map(p=>p.processingEndedAt!.getTime()-p.sourcePublishedAt.getTime()));
 const oldestEligibleMs=eligible?now.getTime()-eligible.createdAt.getTime():null,oldestRunningMs=running?.lockedAt?now.getTime()-running.lockedAt.getTime():null;
 const oldestDueWaitMs=due?now.getTime()-due.availableAt.getTime():null;
 return {at:now.toISOString(),sample:rows.length,sampleLimit:1000,windowMs:3600000,ingestion,queue,eligibleQueueWait,activeDuration,completion,ready,counts,providerWaiting,oldestProviderWaitMs:oldestWait?now.getTime()-oldestWait.updatedAt.getTime():null,oldestEligibleMs,oldestDueWaitMs,oldestRunningMs,targets:latencyTargets(),alerts:latencyAlerts({ingestMs:ingestion.p95Ms,oldestEligibleMs:oldestDueWaitMs,oldestRunningMs,readyMs:ready.p95Ms})};
}
