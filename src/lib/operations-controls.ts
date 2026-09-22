import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import type {PrismaClient,Prisma} from '@prisma/client';
import {assertSuperAdmin} from './dashboard-permissions';
import {lockEditorialPublication} from './human-editorial-contract';
import {ProcessingError} from './processing/contracts';
import {syncAutomaticSources} from './telegram/source-authorization';
import {automaticControlState} from './telegram/auto-control';
export const operationSchema=z.object({requestId:z.uuid(),kind:z.enum(['AUTO_PUBLISH','AUTO_PUBLISH_RECOVERY','PUBLISHING_HOLD','PROCESSING_HOLD','SOURCE_ENABLED','SOURCE_MODE','SOURCE_PROCESSING_HOLD','RETRY']),target:z.string().max(100),value:z.string().max(30),expected:z.string().max(150),confirmed:z.literal(true)}).strict();
export const safeRetryCodes=['SOURCE_DISABLED','LIVE_SOURCE_DISABLED','LEASE_EXHAUSTED','PROCESSING_FAILED'] as const;
export async function assertPublishingActive(tx:Prisma.TransactionClient){if((await tx.appSettings.findUniqueOrThrow({where:{id:1}})).publishingPaused)throw new ProcessingError('OPERATIONS_PUBLISHING_PAUSED');}
export async function operate(db:PrismaClient,userId:string,raw:unknown){
 const input=operationSchema.parse(raw);
 return db.$transaction(async tx=>{
  // Same auth-management lock fences role revocation against sensitive actions.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(184209,3)::text`;
  const actor=await tx.dashboardUser.findUniqueOrThrow({where:{id:userId}});
  if(!actor.enabled)throw new Error('FORBIDDEN');
  if(input.kind==='AUTO_PUBLISH'){if(!['SUPER_ADMIN','ADMIN','EDITOR'].includes(actor.role))throw new Error('FORBIDDEN');}else assertSuperAdmin(actor.role);
  await lockEditorialPublication(tx);
  const auditId=`operation:${input.requestId}`;
  const prior=await tx.auditLog.findUnique({where:{id:auditId}});
  if(prior){if(prior.actor!==`user:${userId}`||!isDeepStrictEqual(prior.metadata,input))throw new Error('REQUEST_ID_REUSED');return {changed:false};}
  let before:unknown;let modeAudit:Prisma.InputJsonObject|undefined;
  if(input.kind==='AUTO_PUBLISH_RECOVERY'){
   const settings=await tx.appSettings.findUniqueOrThrow({where:{id:1}});
   const state=automaticControlState(settings.telegramAutoPolicy,settings.publishingPaused,await tx.workerHeartbeat.findUnique({where:{id:'telegram-publisher-worker'}}));
   const policy=state.policy;
   if(!policy||input.target!=='1'||input.value!=='ACKNOWLEDGE'||input.expected!==`${state.expected}:${policy.reason}`)throw new Error('STALE_CONTROL');
   if(!state.canAcknowledge||settings.publishingMode!=='REQUIRE_APPROVAL')throw new Error('AUTOMATIC_RECOVERY_BLOCKED');
   // Recovery never retries or changes publications. Every unfinished intent must
   // first have an explicit terminal disposition; READY stories are unaffected.
   if(await tx.publication.count({where:{automaticPolicyId:policy.id,status:{in:['PENDING','SENDING','UNKNOWN','FAILED']}}}))throw new Error('DELIVERY_RECONCILIATION_REQUIRED');
   if(await tx.publication.count({where:{automaticPolicyId:policy.id,status:'CANCELLED',OR:[{attemptCount:{not:0}},{attempts:{some:{}}},{telegramMessageId:{not:null}},{claimedAt:{not:null}},{sentAt:{not:null}}]}}))throw new Error('DELIVERY_RECONCILIATION_REQUIRED');
   before=policy;
   await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...policy,state:'CLOSED',reason:'OPERATOR_DISABLED'}}});
  }else if(input.kind==='AUTO_PUBLISH'){
   const settings=await tx.appSettings.findUniqueOrThrow({where:{id:1}});
   const heartbeat=await tx.workerHeartbeat.findUnique({where:{id:'telegram-publisher-worker'}});
   const state=automaticControlState(settings.telegramAutoPolicy,settings.publishingPaused,heartbeat);
   if(input.target!=='1'||state.expected!==input.expected||!['true','false'].includes(input.value))throw new Error('STALE_CONTROL');
   const policy=state.policy;if(!policy)throw new Error('AUTOMATIC_AUTHORIZATION_REQUIRED');
   before=policy;
   if(input.value==='true'){
    if(!state.canEnable)throw new Error('AUTOMATIC_ENABLE_BLOCKED');
    if(await tx.publication.count({where:{automaticPolicyId:{not:null},status:{in:['SENDING','UNKNOWN','FAILED']}}}))throw new Error('DELIVERY_RECONCILIATION_REQUIRED');
    const {reason: _reason,...retained}=policy;void _reason;
    const revision=randomUUID();const notBefore=new Date().toISOString();
    await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...retained,id:revision,state:'ACTIVE',notBefore,authorizedBy:`user:${userId}`}}});
    modeAudit={policyRevision:revision,notBefore};
   }else{
    if(!state.canDisable)throw new Error('AUTOMATIC_DISABLE_BLOCKED');
    const revision=randomUUID();
    await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...policy,id:revision,state:'CLOSED',reason:'OPERATOR_DISABLED',authorizedBy:`user:${userId}`}}});
    modeAudit={policyRevision:revision};
   }
   modeAudit={...modeAudit,actorId:actor.id,username:actor.username,role:actor.role,previousMode:policy.state==='ACTIVE'?'AUTOMATIC':'MANUAL',requestedMode:input.value==='true'?'AUTOMATIC':'MANUAL',previousEffective:state.enabled?'AUTOMATIC':'MANUAL',previousAcknowledged:state.observed,changedAt:new Date().toISOString()};
  }else if(input.kind==='PUBLISHING_HOLD'||input.kind==='PROCESSING_HOLD'){
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
   if(input.kind==='SOURCE_ENABLED')await syncAutomaticSources(tx,`user:${userId}`);
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
  await tx.auditLog.create({data:{actor:`user:${userId}`,action:`OPERATIONS_${input.kind}`,entityType:input.kind.startsWith('SOURCE_')?'Source':input.kind==='RETRY'?'ProcessingJob':'AppSettings',entityId:input.target,message:'تغيير تشغيلي مؤكد',metadata:{before:before as Prisma.InputJsonValue,after:input.value,requestId:input.requestId,...modeAudit}}});
  return {changed:true};
 },{timeout:30000});
}
