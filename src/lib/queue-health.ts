import type {PrismaClient} from '@prisma/client';
import {providerAdmissionDelay} from '../worker/provider-guard';
export function latencySummary(values:number[]){
 const sorted=values.filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);
 const at=(p:number)=>sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;
 return {count:sorted.length,medianMs:at(.5),p95Ms:at(.95)};
}
export async function queueHealth(db:PrismaClient,now=new Date()){
 const since=new Date(now.getTime()-3600000);
 const [groups,oldest,retry,finished,budget,admission]=await Promise.all([
  db.processingJob.groupBy({by:['status'],_count:true}),
  db.processingJob.findFirst({where:{status:'PENDING'},orderBy:{createdAt:'asc'},select:{createdAt:true}}),
  db.processingJob.findFirst({where:{status:'RETRY'},orderBy:{availableAt:'asc'},select:{availableAt:true}}),
  db.processingJob.findMany({where:{status:{in:['COMPLETED','FAILED']},updatedAt:{gte:since}},select:{sourcePostId:true,updatedAt:true,createdAt:true}}),
  db.auditLog.findMany({where:{action:'PROVIDER_COOLDOWN',createdAt:{gte:new Date(now.getTime()-86400000)}},select:{metadata:true}}),
  providerAdmissionDelay(db),
 ]);
 const starts=finished.length?await db.auditLog.findMany({where:{action:'PROCESSING_ATTEMPT_STARTED',entityType:'SourcePost',entityId:{in:finished.map(j=>j.sourcePostId)}},select:{entityId:true,createdAt:true},orderBy:{createdAt:'asc'}}):[];
 const first=new Map<string,number>(),last=new Map<string,number>();
 for(const a of starts){if(!a.entityId)continue;if(!first.has(a.entityId))first.set(a.entityId,a.createdAt.getTime());last.set(a.entityId,a.createdAt.getTime());}
 const samples=finished.filter(j=>first.has(j.sourcePostId));
 const cooldownUntil=Math.max(0,...budget.map(r=>Number((r.metadata as {until?:number})?.until)||0));
 return {at:now,counts:Object.fromEntries(groups.map(g=>[g.status,g._count])),oldestPendingMs:oldest?now.getTime()-oldest.createdAt.getTime():0,
  nextRetry:retry?.availableAt??null,nextAdmission:new Date(now.getTime()+admission),cooldownUntil:cooldownUntil>now.getTime()?new Date(cooldownUntil):null,
  finishedLastHour:finished.length,
  queueWait:latencySummary(samples.map(j=>first.get(j.sourcePostId)!-j.createdAt.getTime())),
  processing:latencySummary(samples.map(j=>j.updatedAt.getTime()-last.get(j.sourcePostId)!)),
  endToEnd:latencySummary(samples.map(j=>j.updatedAt.getTime()-j.createdAt.getTime())),
 };
}
