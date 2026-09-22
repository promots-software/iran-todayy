import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import type {PrismaClient,Prisma} from '@prisma/client';
import {assertSuperAdmin} from './dashboard-permissions';
import {lockEditorialPublication} from './human-editorial-contract';
import {ProcessingError} from './processing/contracts';
export const operationSchema=z.object({requestId:z.uuid(),kind:z.enum(['PUBLISHING_HOLD','PROCESSING_HOLD','SOURCE_ENABLED','SOURCE_MODE','SOURCE_PROCESSING_HOLD','RETRY']),target:z.string().max(100),value:z.string().max(30),expected:z.string().max(100),confirmed:z.literal(true)}).strict();
export const safeRetryCodes=['SOURCE_DISABLED','LIVE_SOURCE_DISABLED','LEASE_EXHAUSTED','PROCESSING_FAILED'] as const;
export async function assertPublishingActive(tx:Prisma.TransactionClient){if((await tx.appSettings.findUniqueOrThrow({where:{id:1}})).publishingPaused)throw new ProcessingError('OPERATIONS_PUBLISHING_PAUSED');}
export async function operate(db:PrismaClient,userId:string,raw:unknown){
 const input=operationSchema.parse(raw);
 return db.$transaction(async tx=>{
  // Same auth-management lock fences role revocation against sensitive actions.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(184209,3)::text`;
  const actor=await tx.dashboardUser.findUniqueOrThrow({where:{id:userId}});
  if(!actor.enabled)throw new Error('FORBIDDEN');assertSuperAdmin(actor.role);
  await lockEditorialPublication(tx);
  const auditId=`operation:${input.requestId}`;
  const prior=await tx.auditLog.findUnique({where:{id:auditId}});
  if(prior){if(prior.actor!==`user:${userId}`||!isDeepStrictEqual(prior.metadata,input))throw new Error('REQUEST_ID_REUSED');return {changed:false};}
  let before:unknown;
  if(input.kind==='PUBLISHING_HOLD'||input.kind==='PROCESSING_HOLD'){
   const settings=await tx.appSettings.findUniqueOrThrow({where:{id:1}}),key=input.kind==='PUBLISHING_HOLD'?'publishingPaused':'processingPaused';
   before=settings[key];if(String(before)!==input.expected||!['true','false'].includes(input.value))throw new Error('STALE_CONTROL');
   await tx.appSettings.update({where:{id:1},data:{[key]:input.value==='true'}});
  }else if(input.kind.startsWith('SOURCE_')){
   await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${input.target} FOR UPDATE`;
   const source=await tx.source.findUniqueOrThrow({where:{id:input.target}});if(source.deletedAt)throw new Error('SOURCE_DISABLED');
   const key=input.kind==='SOURCE_MODE'?'processingMode':input.kind==='SOURCE_ENABLED'?'enabled':'processingPaused';before=source[key];
   if(String(before)!==input.expected)throw new Error('STALE_CONTROL');
   if(key==='processingMode'){const processingMode=z.enum(['NORMAL','DIRECT']).parse(input.value);await tx.source.update({where:{id:source.id},data:{processingMode}});}
   else{if(!['true','false'].includes(input.value))throw new Error('INVALID_CONTROL');await tx.source.update({where:{id:source.id},data:{[key]:input.value==='true'}});}
  }else{
   await tx.$queryRaw`SELECT id FROM "ProcessingJob" WHERE id=${input.target} FOR UPDATE`;
   const job=await tx.processingJob.findUniqueOrThrow({where:{id:input.target},include:{sourcePost:{include:{source:true,humanDraft:true,evidence:true}}}});
   if(job.updatedAt.toISOString()!==input.expected||job.status!=='FAILED'||!safeRetryCodes.some(c=>c===job.lastError)||job.sourcePost.humanDraft||job.sourcePost.evidence.length||!job.sourcePost.source.enabled||job.sourcePost.source.deletedAt)throw new Error('RETRY_REQUIRES_RECONCILIATION');
   // An incomplete provider intent can have incurred a charge. Never replay it.
   const checkpoints=await tx.auditLog.findMany({where:{entityType:'SourcePost',entityId:job.sourcePostId,action:{in:['WORKER_PROVIDER_STAGE_STARTED','WORKER_PROVIDER_STAGE_COMPLETED','WORKER_PROVIDER_STAGE_FAILED']}},orderBy:[{createdAt:'asc'},{id:'asc'}]});
   const outcomes=new Map<string,string>();for(const row of checkpoints){const m=row.metadata as {key?:string;replaySafe?:boolean}|null;if(m?.key)outcomes.set(m.key,row.action==='WORKER_PROVIDER_STAGE_COMPLETED'||(row.action==='WORKER_PROVIDER_STAGE_FAILED'&&m.replaySafe===true)?'SAFE':'UNKNOWN');}
   if([...outcomes.values()].includes('UNKNOWN'))throw new Error('RETRY_REQUIRES_RECONCILIATION');
   before={status:job.status,lastError:job.lastError,attemptCount:job.attemptCount};
   await tx.processingJob.update({where:{id:job.id},data:{status:'RETRY',availableAt:new Date(),lockedAt:null,lockedBy:null,maxAttempts:Math.max(job.maxAttempts,job.attemptCount+1)}});
   await tx.sourcePost.update({where:{id:job.sourcePostId},data:{status:'FAILED',nextRetryAt:new Date()}});
  }
  await tx.auditLog.create({data:{id:auditId,actor:`user:${userId}`,action:'OPERATIONS_CONTROL',entityType:'Operations',entityId:input.target,message:input.kind,metadata:input}});
  await tx.auditLog.create({data:{actor:`user:${userId}`,action:`OPERATIONS_${input.kind}`,entityType:input.kind.startsWith('SOURCE_')?'Source':input.kind==='RETRY'?'ProcessingJob':'AppSettings',entityId:input.target,message:'تغيير تشغيلي مؤكد',metadata:{before:before as Prisma.InputJsonValue,after:input.value,requestId:input.requestId}}});
  return {changed:true};
 });
}
