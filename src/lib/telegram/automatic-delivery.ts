import {type PrismaClient} from '@prisma/client';
import {ProcessingError} from '../processing/contracts';
import {approvalDigest,freezeValidatedPublication,publishOne} from './publisher';
import {lockEditorialPublication} from '../human-editorial-contract';
import {reconcileDelivery} from './delivery-receipt';
import {requireAutoPolicy,autoPolicySchema,type AutoPolicy} from './auto-policy';
import {publicationCandidateInclude as include,eligibleAutomatic} from './publication-policy';
export {eligibleAutomatic} from './publication-policy';
// Only deterministic checks thrown BEFORE publication writes may be isolated.
// DB, authorization, policy and uncertain-delivery errors must still escape.
const candidateFreezeErrors=new Set(['FACT_EVIDENCE_CHANGED','DIRECT_GENERATION_RECEIPT_CHANGED','SOURCE_PROVENANCE_REQUIRED','INVALID_EVIDENCE','TITLE_PROVENANCE_REQUIRED','INVALID_DRAFT_FACT_LINK','INCOMPLETE_DRAFT_PROVENANCE','NO_PUBLICATION_CONTENT','TELEGRAM_TEXT_TOO_LONG']);
export async function closeAutomaticPolicy(db:PrismaClient,id:string,reason:string){return db.$transaction(async tx=>{
 await lockEditorialPublication(tx);const s=await tx.appSettings.findUniqueOrThrow({where:{id:1}});const p=autoPolicySchema.safeParse(s.telegramAutoPolicy);
 if(!p.success||p.data.id!==id||p.data.state==='CLOSED')return;
 await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p.data,state:'CLOSED',reason}}});
 await tx.auditLog.create({data:{actor:'automatic-telegram-worker',action:'AUTOMATIC_DELIVERY_STOPPED',entityType:'AppSettings',entityId:'1',message:reason,metadata:{policyId:id}}});
});}
/** One bounded pass; only this policy's new publications may ever be resumed. */
export async function automaticDeliveryCycle(db:PrismaClient,env:Record<string,string|undefined>,transport:typeof fetch=fetch,candidateId?:string,acknowledgedPolicy?:string){
 // Reconciliation is DB-only and must continue even when delivery is disarmed.
 const recovery=await db.publication.findMany({where:{status:{in:['SENDING','UNKNOWN']}},select:{id:true,automaticPolicyId:true},take:100});
 let unresolvedAutomatic=false;
 for(const row of recovery){const recovered=await reconcileDelivery(db,row.id);if(recovered.status==='UNKNOWN'&&row.automaticPolicyId){unresolvedAutomatic=true;await closeAutomaticPolicy(db,row.automaticPolicyId,'DELIVERY_RECONCILIATION_REQUIRED');}}
 const settings=await db.appSettings.findUniqueOrThrow({where:{id:1}});
 if(settings.publishingPaused)return {status:'PAUSED'};
 let policy:AutoPolicy;try{policy=requireAutoPolicy(settings.telegramAutoPolicy,env);}catch{return {status:'DISABLED'};}
 if(unresolvedAutomatic){await closeAutomaticPolicy(db,policy.id,'DELIVERY_RECONCILIATION_REQUIRED');return {status:'STOPPED_UNCERTAIN'};}
 if(acknowledgedPolicy!==undefined&&acknowledgedPolicy!==`${policy.id}:${policy.state}`)return {status:'AWAITING_POLICY_ACKNOWLEDGEMENT'};
 const unresolved=await db.publication.findMany({where:{automaticPolicyId:policy.id,status:{in:['SENDING','UNKNOWN']}},select:{id:true}});
 for(const p of unresolved){const r=await reconcileDelivery(db,p.id);if(r.status==='SENDING')return {status:'IN_FLIGHT'};if(r.status!=='SENT'){await closeAutomaticPolicy(db,policy.id,'DELIVERY_RECONCILIATION_REQUIRED');return {status:'STOPPED_UNCERTAIN'};}}
 const publication=await db.$transaction(async tx=>{
  await lockEditorialPublication(tx);
  const current=await tx.appSettings.findUniqueOrThrow({where:{id:1}});if(current.publishingPaused)return null;
  const p=requireAutoPolicy(current.telegramAutoPolicy,env);if(p.id!==policy.id)return null;
  const owned=await tx.publication.findMany({where:{automaticPolicyId:p.id},select:{id:true,status:true,newsItemId:true},orderBy:{createdAt:'asc'}});
  if(p.state==='CANARY'&&owned.some(x=>x.status==='SENT'))return null;
  if(owned.some(x=>['SENDING','UNKNOWN','FAILED'].includes(x.status)))return null;
  for(const pending of owned.filter(x=>x.status==='PENDING'&&(!candidateId||x.newsItemId===candidateId))){
   if(!pending.newsItemId)continue;
   const item=await tx.newsItem.findUniqueOrThrow({where:{id:pending.newsItemId},include});
   if(eligibleAutomatic(item,p,true))return pending;
  }
  let cursor:string|undefined;
  do {
  const items=await tx.newsItem.findMany({where:{status:'PENDING_APPROVAL',validationStatus:'PASSED',humanDraft:null,publication:null,createdAt:{gte:new Date(p.notBefore)},...(candidateId?{id:candidateId}:p.state==='CANARY'?{id:p.canaryCandidateId!}:{})},include,orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  for(const item of items){
   for(const sourceId of [...new Set(item.evidence.map(e=>e.sourcePost.sourceId))].sort())await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${sourceId} FOR SHARE`;
   const fresh=await tx.newsItem.findUniqueOrThrow({where:{id:item.id},include});if(!eligibleAutomatic(fresh,p))continue;
   try {
    const publication=await freezeValidatedPublication(tx,{newsItemId:fresh.id,digest:approvalDigest(fresh),resolutions:[]},'automatic-telegram-worker',env,'TELEGRAM',true);
    return tx.publication.update({where:{id:publication.id},data:{automaticPolicyId:p.id}});
   }catch(error){
    if(!(error instanceof ProcessingError)||!candidateFreezeErrors.has(error.code))throw error;
    // Preserve evidence/validation receipts. A blocked item needs explicit review;
    // later cycles cannot silently retry it or prevent unrelated READY delivery.
    await tx.newsItem.update({where:{id:fresh.id},data:{status:'NEEDS_REVIEW',error:error.code,validationResult:{...Object(fresh.validationResult),editorialEligibility:'NEEDS_REVIEW',deliveryDecision:'HOLD',publicationFreezeFailure:{code:error.code,stage:'FREEZE'}}}});
    await tx.auditLog.create({data:{actor:'automatic-telegram-worker',action:'AUTOMATIC_PUBLICATION_BLOCKED',entityType:'NewsItem',entityId:fresh.id,message:error.code,metadata:{policyId:p.id,stage:'FREEZE',digest:approvalDigest(fresh),publicationCreated:false,priorValidationResult:fresh.validationResult}}});
   }
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
 }catch(error){
  // A runtime revocation before the claim is an intentional hold, not delivery uncertainty.
  if(error instanceof ProcessingError&&['AUTOMATIC_DELIVERY_DISABLED','AUTOMATIC_AUTHORIZATION_CHANGED','OPERATIONS_PUBLISHING_PAUSED'].includes(error.code))return {status:'AUTHORIZATION_HELD'};
  await closeAutomaticPolicy(db,policy.id,'DELIVERY_PERSISTENCE_OR_SAFETY_FAILURE');throw error instanceof ProcessingError?error:new ProcessingError('DELIVERY_PERSISTENCE_FAILED');
 }
}
