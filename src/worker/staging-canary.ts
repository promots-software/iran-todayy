import {stagingBatchSchema} from './staging-batch';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {Prisma,type PrismaClient} from '@prisma/client';

const target=z.string().regex(/^c[a-z0-9]{20,31}$/);
export const stagingCanarySchema=z.object({version:z.literal('staging-canary-v1'),mode:z.literal('CANARY_SELECTED'),targetSourcePostId:target,databaseName:z.string().min(1).max(100),requestId:z.uuid(),authorizedBy:z.string().min(1).max(100)}).strict();
type Settings={processingPaused:boolean;stagingCanaryPolicy:unknown};
export function canaryAdmission(settings:Settings,env:Record<string,string|undefined>=process.env){
 const configured=settings.stagingCanaryPolicy!==null&&settings.stagingCanaryPolicy!==undefined;
 const parsed=stagingCanarySchema.safeParse(settings.stagingCanaryPolicy);
 const batch=stagingBatchSchema.safeParse(settings.stagingCanaryPolicy);
 const base={processingMode:settings.processingPaused?'PAUSED':configured?(batch.success?'BATCH_30':'CANARY_SELECTED'):'NORMAL',canaryTargetSourcePostId:parsed.success?parsed.data.targetSourcePostId:null,canaryClaimAllowed:false,canaryClaimBlockedReason:null as string|null};
 if(settings.processingPaused)return {...base,canaryClaimBlockedReason:'GLOBAL_PROCESSING_HOLD'};
 if(!configured)return {...base,canaryClaimAllowed:true};
 if(!parsed.success&&!batch.success)return {...base,canaryClaimBlockedReason:'INVALID_CANARY_CONFIGURATION'};
 if(env.IRAN_TODAY_ENVIRONMENT!=='staging'||env.TELEGRAM_CHAT_ID!=='-1004436536617')return {...base,canaryClaimBlockedReason:'CANARY_ENVIRONMENT_MISMATCH'};
 return {...base,canaryClaimAllowed:true};
}

/** Future operator entry point. No live call is made by importing this module.
 * Installs the target before releasing the hold in the SAME transaction.
 * There is deliberately no fallback/reset-to-NORMAL operation here. */
export async function configureStagingCanary(db:PrismaClient,raw:unknown,execute=false){
 const policy=stagingCanarySchema.parse(raw);
 const admission=canaryAdmission({processingPaused:false,stagingCanaryPolicy:policy});
 if(!admission.canaryClaimAllowed)throw Error(admission.canaryClaimBlockedReason!);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "AppSettings" WHERE id=1 FOR UPDATE`;
  const settings=await tx.appSettings.findUniqueOrThrow({where:{id:1}});
  if(!settings.processingPaused)throw Error('CANARY_SETUP_REQUIRES_PAUSE');
  const [database]=await tx.$queryRaw<{name:string}[]>`SELECT current_database() AS name`;
  if(database.name!==policy.databaseName)throw Error('CANARY_DATABASE_MISMATCH');
  if(await tx.processingJob.count({where:{status:'RUNNING'}}))throw Error('CANARY_RUNNING_JOBS_EXIST');
  const post=await tx.sourcePost.findUnique({where:{id:policy.targetSourcePostId},include:{source:true,jobs:true}});
  if(!post||post.status!=='INGESTED'||!post.source.enabled||post.source.deletedAt||post.source.processingPaused||post.source.platform!=='TELEGRAM'||!post.jobs.some(j=>j.stage==='PROCESS_V1'&&j.status==='PENDING'&&j.attemptCount===0))throw Error('CANARY_TARGET_NOT_FRESH_PENDING');
  if(settings.stagingCanaryPolicy!==null&&!isDeepStrictEqual(settings.stagingCanaryPolicy,policy))throw Error('CANARY_TARGET_ALREADY_CONFIGURED');
  await tx.appSettings.update({where:{id:1},data:{stagingCanaryPolicy:policy,processingPaused:!execute}});
  await tx.auditLog.create({data:{action:execute?'STAGING_CANARY_ACTIVATED':'STAGING_CANARY_CONFIGURED',actor:policy.authorizedBy,entityType:'AppSettings',entityId:'1',message:'Selected story only; no unrestricted queue release',metadata:{...admission,requestId:policy.requestId,executionEnabled:execute}}});
 });
}

export const canaryTargetSql=(id:string|null)=>id?Prisma.sql`AND "sourcePostId" = ${id}`:Prisma.empty;

/** Explicit return to normal staging admission. Keep the queue paused until the
 * separate, existing audited processing-resume action is applied. */
export async function clearStagingCanary(db:PrismaClient,databaseName:string,actor:string){
 if(process.env.IRAN_TODAY_ENVIRONMENT!=='staging'||process.env.TELEGRAM_CHAT_ID!=='-1004436536617'||!actor.trim()||!databaseName.trim())throw Error('CANARY_ENVIRONMENT_MISMATCH');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "AppSettings" WHERE id=1 FOR UPDATE`;
  const settings=await tx.appSettings.findUniqueOrThrow({where:{id:1}});
  const [database]=await tx.$queryRaw<{name:string}[]>`SELECT current_database() AS name`;
  if(database.name!==databaseName)throw Error('CANARY_DATABASE_MISMATCH');
  if(!settings.processingPaused)throw Error('CANARY_SETUP_REQUIRES_PAUSE');
  if(await tx.processingJob.count({where:{status:'RUNNING'}}))throw Error('CANARY_RUNNING_JOBS_EXIST');
  if(settings.stagingCanaryPolicy===null)return;
  await tx.appSettings.update({where:{id:1},data:{stagingCanaryPolicy:Prisma.DbNull}});
  await tx.auditLog.create({data:{action:'STAGING_CANARY_DEACTIVATED',actor,entityType:'AppSettings',entityId:'1',message:'Selected-item restriction removed by explicit staging authorization; processing remains paused',metadata:{previous:settings.stagingCanaryPolicy,databaseName}}});
 });
}
