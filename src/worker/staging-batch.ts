import {z} from 'zod';
import {Prisma,type PrismaClient} from '@prisma/client';
const target=z.string().regex(/^c[a-z0-9]{20,31}$/);
export const stagingBatchSchema=z.object({version:z.literal('staging-batch-v1'),mode:z.literal('BATCH_30'),limit:z.number().int().min(1).max(30),sourcePostIds:z.array(target).max(30),notBefore:z.iso.datetime(),databaseName:z.string().min(1),requestId:z.uuid(),authorizedBy:z.string().min(1),settledAt:z.iso.datetime().nullable()}).strict().refine(p=>new Set(p.sourcePostIds).size===p.sourcePostIds.length&&p.sourcePostIds.length<=p.limit);
export type StagingBatch=z.infer<typeof stagingBatchSchema>;
export async function configureStagingBatch(db:PrismaClient,raw:unknown){
 const p=stagingBatchSchema.parse(raw);
 if(process.env.IRAN_TODAY_ENVIRONMENT!=='staging'||process.env.TELEGRAM_CHAT_ID!=='-1004436536617'||p.sourcePostIds.length||p.settledAt)throw Error('BATCH_CONFIGURATION_INVALID');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "AppSettings" WHERE id=1 FOR UPDATE`;
  const s=await tx.appSettings.findUniqueOrThrow({where:{id:1}});
  const [d]=await tx.$queryRaw<{name:string}[]>`SELECT current_database() AS name`;
  if(d.name!==p.databaseName||!s.processingPaused||s.stagingCanaryPolicy!==null||await tx.processingJob.count({where:{status:'RUNNING'}}))throw Error('BATCH_PREFLIGHT_FAILED');
  await tx.appSettings.update({where:{id:1},data:{stagingCanaryPolicy:p,processingPaused:false}});
  await tx.auditLog.create({data:{action:'STAGING_BATCH_ACTIVATED',actor:p.authorizedBy,entityType:'AppSettings',entityId:'1',message:`At most ${p.limit} first-time source posts; immutable membership recorded atomically at claim`,metadata:p}});
 });
}
/** Called under the AppSettings exclusive lock; no admission beyond the configured bound is possible. */
export async function batchRestriction(tx:Prisma.TransactionClient,p:StagingBatch){
 const [d]=await tx.$queryRaw<{name:string}[]>`SELECT current_database() AS name`;
 if(d.name!==p.databaseName)throw Error('BATCH_DATABASE_MISMATCH');
 const members=p.sourcePostIds.length?Prisma.sql`"sourcePostId" IN (${Prisma.join(p.sourcePostIds)})`:Prisma.sql`FALSE`;
 if(p.sourcePostIds.length===p.limit){
  const unsettled=await tx.processingJob.count({where:{sourcePostId:{in:p.sourcePostIds},stage:'PROCESS_V1',status:{in:['PENDING','RETRY','RUNNING']}}});
  if(!unsettled){
   const settled={...p,settledAt:p.settledAt??new Date().toISOString()};
   await tx.appSettings.update({where:{id:1},data:{processingPaused:true,stagingCanaryPolicy:settled}});
   await tx.auditLog.create({data:{action:'STAGING_BATCH_SETTLED',actor:'staging-worker',entityType:'AppSettings',entityId:'1',message:`All ${p.limit} settled; processing automatically paused`,metadata:settled}});
   return null;
  }
  return Prisma.sql`AND (${members})`;
 }
 return Prisma.sql`AND (${members} OR ("status"='PENDING' AND "attemptCount"=0 AND EXISTS (SELECT 1 FROM "SourcePost" fresh WHERE fresh.id="ProcessingJob"."sourcePostId" AND fresh."processingStartedAt" IS NULL AND fresh.status='INGESTED' AND fresh."ingestedAt">=CAST(${p.notBefore} AS timestamp))))`;
}
export async function recordBatchClaim(tx:Prisma.TransactionClient,p:StagingBatch,postId:string,jobId:string,workerId:string){
 if(p.sourcePostIds.includes(postId))return;
 if(p.sourcePostIds.length>=p.limit)throw Error('BATCH_LIMIT_REACHED');
 const next={...p,sourcePostIds:[...p.sourcePostIds,postId]};
 await tx.appSettings.update({where:{id:1},data:{stagingCanaryPolicy:next}});
 await tx.auditLog.create({data:{action:'STAGING_BATCH_MEMBER_CLAIMED',actor:workerId,entityType:'SourcePost',entityId:postId,message:'Durable distinct source-post membership before processing',metadata:{requestId:p.requestId,index:next.sourcePostIds.length,limit:p.limit,jobId}}});
}
