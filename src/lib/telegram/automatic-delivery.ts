import {Prisma,type PrismaClient} from '@prisma/client';
import {validateUnderstanding,sourceProfileSchema,ProcessingError} from '../processing/contracts';
import {editorialScope} from '../processing/editorial-scope';
import {eligibleDirectPublication} from './direct-auto';
import {approvalDigest,freezeValidatedPublication,publishOne} from './publisher';
import {lockEditorialPublication} from '../human-editorial-contract';
import {reconcileDelivery} from './delivery-receipt';
import {requireAutoPolicy,autoPolicySchema,type AutoPolicy} from './auto-policy';
const include={humanDraft:true,publication:true,eventRevision:true,evidence:{include:{sourcePost:{include:{source:true,jobs:true,matches:true,humanDraft:true}}}}} satisfies Prisma.NewsItemInclude;
type Candidate=Prisma.NewsItemGetPayload<{include:typeof include}>;
const obj=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const clean=(x:unknown,mode:string)=>{const r=obj(x);return r.processingMode===mode&&r.validated===true&&r.editorialEligibility==='READY_TO_PUBLISH'&&Array.isArray(r.review)&&r.review.length===0;};
export function eligibleAutomatic(item:Candidate,p:AutoPolicy){
 const since=new Date(p.notBefore);
 if(item.createdAt<since||p.state==='CLOSED'||(p.state==='CANARY'&&p.canaryCandidateId!==item.id)||!item.evidence.length||item.evidence.some(e=>!p.sourceIds.includes(e.sourcePost.sourceId)||e.sourcePost.ingestedAt<since||e.sourcePost.sourcePublishedAt<since))return false;
 const mode=obj(item.validationResult).processingMode;
 if(mode==='DIRECT')return eligibleDirectPublication(item);
 if(mode!=='NORMAL'||item.status!=='PENDING_APPROVAL'||item.validationStatus!=='PASSED'||item.error||item.rejectionReason||item.needsReviewReasons.length||item.humanDraft||item.publication||!clean(item.validationResult,'NORMAL'))return false;
 for(const {sourcePost:s} of item.evidence){
  const result=obj(s.processingResult),profile=sourceProfileSchema.safeParse(s.source.editorialProfile);
  if(s.source.processingMode!=='NORMAL'||!s.source.enabled||s.source.deletedAt||s.source.platform!=='TELEGRAM'||!profile.success||!profile.data.verified||profile.data.flagged||s.humanDraft||s.status!=='PENDING_APPROVAL'||s.error||s.rejectionReason||s.relevance!=='POLITICAL_NEWS'||!clean(result,'NORMAL'))return false;
  if(!s.jobs.length||s.jobs.some(j=>j.status!=='COMPLETED')||result.eventRevisionId!==item.eventRevisionId||!['NEW_EVENT','MATERIAL_UPDATE'].includes(String(result.classification))||!s.matches.some(m=>m.eventRevisionId===item.eventRevisionId&&['NEW_EVENT','MATERIAL_UPDATE'].includes(m.classification))||s.matches.some(m=>['UNCERTAIN','UNCERTAIN_MATCH'].includes(m.classification)))return false;
  if(editorialScope(s.originalContent).status!=='IN_SCOPE')return false;
  try{const u=validateUnderstanding(result.extraction,s.originalContent);if(u.relevance!=='POLITICAL_NEWS'||u.filterReason!=='NONE'||u.priority==='P4')return false;}catch{return false;}
 }
 return true;
}
export async function closeAutomaticPolicy(db:PrismaClient,id:string,reason:string){return db.$transaction(async tx=>{
 await lockEditorialPublication(tx);const s=await tx.appSettings.findUniqueOrThrow({where:{id:1}});const p=autoPolicySchema.safeParse(s.telegramAutoPolicy);
 if(!p.success||p.data.id!==id||p.data.state==='CLOSED')return;
 await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p.data,state:'CLOSED',reason}}});
 await tx.auditLog.create({data:{actor:'automatic-telegram-worker',action:'AUTOMATIC_DELIVERY_STOPPED',entityType:'AppSettings',entityId:'1',message:reason,metadata:{policyId:id}}});
});}
/** One bounded pass; only this policy's new publications may ever be resumed. */
export async function automaticDeliveryCycle(db:PrismaClient,env:Record<string,string|undefined>,transport:typeof fetch=fetch){
 // Reconciliation is DB-only and must continue even when delivery is disarmed.
 const recovery=await db.publication.findMany({where:{status:{in:['SENDING','UNKNOWN']}},select:{id:true,automaticPolicyId:true},take:100});
 for(const row of recovery){const recovered=await reconcileDelivery(db,row.id);if(recovered.status==='UNKNOWN'&&row.automaticPolicyId)await closeAutomaticPolicy(db,row.automaticPolicyId,'DELIVERY_RECONCILIATION_REQUIRED');}
 const settings=await db.appSettings.findUniqueOrThrow({where:{id:1}});
 if(settings.publishingPaused)return {status:'PAUSED'};
 let policy:AutoPolicy;try{policy=requireAutoPolicy(settings.telegramAutoPolicy,env);}catch{return {status:'DISABLED'};}
 const unresolved=await db.publication.findMany({where:{automaticPolicyId:policy.id,status:{in:['SENDING','UNKNOWN']}},select:{id:true}});
 for(const p of unresolved){const r=await reconcileDelivery(db,p.id);if(r.status==='SENDING')return {status:'IN_FLIGHT'};if(r.status!=='SENT'){await closeAutomaticPolicy(db,policy.id,'DELIVERY_RECONCILIATION_REQUIRED');return {status:'STOPPED_UNCERTAIN'};}}
 const publication=await db.$transaction(async tx=>{
  await lockEditorialPublication(tx);
  const current=await tx.appSettings.findUniqueOrThrow({where:{id:1}});if(current.publishingPaused)return null;
  const p=requireAutoPolicy(current.telegramAutoPolicy,env);if(p.id!==policy.id)return null;
  const owned=await tx.publication.findMany({where:{automaticPolicyId:p.id},orderBy:{createdAt:'asc'}});
  if(p.state==='CANARY'&&owned.some(x=>x.status==='SENT'))return null;
  if(owned.some(x=>['SENDING','UNKNOWN','FAILED'].includes(x.status)))return null;
  const pending=owned.find(x=>x.status==='PENDING');if(pending)return pending;
  let cursor:string|undefined;
  do {
  const items=await tx.newsItem.findMany({where:{status:'PENDING_APPROVAL',validationStatus:'PASSED',humanDraft:null,publication:null,createdAt:{gte:new Date(p.notBefore)},...(p.state==='CANARY'?{id:p.canaryCandidateId!}:{})},include,orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  for(const item of items){
   for(const sourceId of [...new Set(item.evidence.map(e=>e.sourcePost.sourceId))].sort())await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${sourceId} FOR SHARE`;
   const fresh=await tx.newsItem.findUniqueOrThrow({where:{id:item.id},include});if(!eligibleAutomatic(fresh,p))continue;
   const publication=await freezeValidatedPublication(tx,{newsItemId:fresh.id,digest:approvalDigest(fresh),resolutions:[]},'automatic-telegram-worker',env,'TELEGRAM',true);
   return tx.publication.update({where:{id:publication.id},data:{automaticPolicyId:p.id}});
  }
  cursor=items.length===100?items.at(-1)!.id:undefined;
  }while(cursor);
  return null;
 },{timeout:30000});
 if(!publication){if(policy.state==='CANARY'&&await db.publication.count({where:{automaticPolicyId:policy.id,status:'SENT'}})){await closeAutomaticPolicy(db,policy.id,'CANARY_COMPLETE');return {status:'CANARY_COMPLETE'};}return {status:'NO_ELIGIBLE_STORY'};}
 try{
 const result=await publishOne(db,publication.id,env,transport);
 if(result.status==='UNKNOWN'||result.status==='FAILED')await closeAutomaticPolicy(db,policy.id,'DELIVERY_RECONCILIATION_REQUIRED');
 if(result.status==='SENT'&&policy.state==='CANARY')await closeAutomaticPolicy(db,policy.id,'CANARY_COMPLETE');
 return {...result,publicationId:publication.id};
 }catch(error){await closeAutomaticPolicy(db,policy.id,'DELIVERY_PERSISTENCE_OR_SAFETY_FAILURE');throw error instanceof ProcessingError?error:new ProcessingError('DELIVERY_PERSISTENCE_FAILED');}
}
