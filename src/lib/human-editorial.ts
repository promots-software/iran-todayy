import {sourceHasMedia} from './publication-media';
import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {ProcessingError} from './processing/contracts';
import {assertApprovalMode} from './processing/shadow';
import {humanDigest,humanText,lockEditorialPublication} from './human-editorial-contract';
import {readPublisherEnv} from './telegram/publisher';
const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
const targetSchema=z.object({kind:z.enum(['post','news']),id:z.string().min(1).max(100)});
export type EditorialTarget=z.infer<typeof targetSchema>;
async function origin(tx:Prisma.TransactionClient,target:EditorialTarget){
 if(target.kind==='news'){
  const item=await tx.newsItem.findUniqueOrThrow({where:{id:target.id},include:{publication:true,evidence:{include:{sourcePost:true}}}});
  if(item.publication)throw new ProcessingError('EXISTING_AI_PUBLICATION_REQUIRES_RECONCILIATION');
  if(!['NEEDS_REVIEW','PENDING_APPROVAL','FAILED','REJECTED'].includes(item.status)||!item.evidence.length)throw new ProcessingError('ITEM_NOT_REVIEWABLE');
  return {where:{newsItemId:item.id},snapshot:item};
 }
 const post=await tx.sourcePost.findUniqueOrThrow({where:{id:target.id},include:{evidence:true,jobs:true}});
 if(post.evidence.length)throw new ProcessingError('EDIT_LINKED_NEWS_ITEM');
 if(!['NEEDS_REVIEW','FAILED','REJECTED'].includes(post.status))throw new ProcessingError('ITEM_NOT_REVIEWABLE');
 return {where:{sourcePostId:post.id},snapshot:post};
}
export async function saveHumanDraft(db:PrismaClient,input:EditorialTarget & {revision:number;title:string;body:string;publicationImageId?:string|null;mediaDecision?:boolean},actor:string){
 if(!actor.trim())throw new ProcessingError('AUTHENTICATION_REQUIRED');
 const target=targetSchema.parse(input);z.number().int().min(0).parse(input.revision);
 const text={title:z.string().min(1).max(4096).parse(input.title),body:z.string().min(1).max(4096).parse(input.body)};humanText(text);
 return db.$transaction(async tx=>{
  await lockEditorialPublication(tx);assertApprovalMode((await tx.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode);
  const source=await origin(tx,target);
  const current=await tx.humanEditorialDraft.findFirst({where:source.where,include:{publications:true}});
  if(current?.publications.some(p=>p.status!=='CANCELLED'&&(p.status!=='PENDING'||p.attemptCount!==0)))throw new ProcessingError('PUBLICATION_LOCKED');
  if(current?.title===text.title&&current.body===text.body&&(current.publicationImageId??null)===(input.publicationImageId??null)&&!!current.mediaDecisionAt===!!input.mediaDecision&&(input.revision===current.revision||input.revision===current.revision-1))return current;
  if((current?.revision??0)!==input.revision)throw new ProcessingError('STALE_EDITORIAL_DRAFT');
  if(current){
   for(const p of current.publications.filter(p=>p.status==='PENDING')){
    await tx.publication.update({where:{id:p.id},data:{status:'CANCELLED',error:'HUMAN_EDIT_INVALIDATED_APPROVAL'}});
    await tx.auditLog.create({data:{actor,action:'HUMAN_APPROVAL_INVALIDATED',entityType:'Publication',entityId:p.id,message:'Edit invalidated prior approval; frozen historical preview retained',metadata:json({draftId:current.id,revision:current.revision})}});
   }
  }
  if(input.publicationImageId&&!await tx.publicationImage.findUnique({where:{id:input.publicationImageId}}))throw new ProcessingError('INVALID_PUBLICATION_IMAGE');
  const media={publicationImageId:input.publicationImageId??null,mediaDecisionAt:input.mediaDecision?new Date():null};
  const draft=current?await tx.humanEditorialDraft.update({where:{id:current.id},data:{...text,...media,revision:{increment:1},status:'DRAFT',editedBy:actor,approvedAt:null,approvedBy:null,approvalNote:null}}):await tx.humanEditorialDraft.create({data:{...source.where,...text,...media,originalSnapshot:json(source.snapshot),editedBy:actor}});
  await tx.auditLog.create({data:{actor,action:'HUMAN_DRAFT_SAVED',entityType:'HumanEditorialDraft',entityId:draft.id,message:'Human-authored revision saved; automated validation remains unchanged',metadata:json({revision:draft.revision,title:draft.title,body:draft.body,originalSnapshot:draft.originalSnapshot,publicationImageId:draft.publicationImageId,previousImageId:current?.publicationImageId??null,mediaDecisionAt:draft.mediaDecisionAt,previousRevision:current?.revision??null})}});
  if(current?.publicationImageId!==draft.publicationImageId)await tx.auditLog.create({data:{actor,action:draft.publicationImageId?'PUBLICATION_IMAGE_SELECTED':'PUBLICATION_IMAGE_REMOVED',entityType:'HumanEditorialDraft',entityId:draft.id,message:draft.publicationImageId?'اختيار صورة النشر':'إزالة صورة النشر',metadata:json({previousImageId:current?.publicationImageId??null,imageId:draft.publicationImageId,revision:draft.revision})}});
  return draft;
 });
}
export async function approveHumanDraft(db:PrismaClient,input:{id:string;digest:string;confirmed:boolean;note:string},actor:string,env:Record<string,string|undefined>=process.env,target:'TELEGRAM'|'WEB'='TELEGRAM'){
 if(!actor.trim())throw new ProcessingError('AUTHENTICATION_REQUIRED');
 if(!input.confirmed||input.note.trim().length<20||input.note.length>5000)throw new ProcessingError('HUMAN_RESPONSIBILITY_REQUIRED');
 const chatId=target==='WEB'?'WEB':readPublisherEnv(env).chatId;
 return db.$transaction(async tx=>{
  await lockEditorialPublication(tx);assertApprovalMode((await tx.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode);
  const d=await tx.humanEditorialDraft.findUniqueOrThrow({where:{id:input.id},include:{publications:true}});
  if(target==='TELEGRAM'&&d.publicationImageId)throw new ProcessingError('IMAGE_WEB_ONLY');
  if(humanDigest(d)!==input.digest)throw new ProcessingError('STALE_EDITORIAL_DRAFT');
  const existing=d.publications.find(p=>p.status!=='CANCELLED');
  if(existing){if(existing.destination!==chatId)throw new ProcessingError('PUBLICATION_DESTINATION_LOCKED');if(existing.idempotencyKey===input.digest)return existing;throw new ProcessingError('PUBLICATION_LOCKED');}
  const original=await origin(tx,{kind:d.newsItemId?'news':'post',id:d.newsItemId??d.sourcePostId!});
  const snapshot=original.snapshot;
  const hasMedia='metadata' in snapshot?sourceHasMedia(snapshot.metadata):snapshot.evidence.some(e=>sourceHasMedia(e.sourcePost.metadata));
  if(hasMedia&&!d.mediaDecisionAt)throw new ProcessingError('SOURCE_MEDIA_DECISION_REQUIRED');
  const p=await tx.publication.create({data:{humanDraftId:d.id,idempotencyKey:humanDigest(d),destination:chatId,publicationImageId:d.publicationImageId,contentSnapshot:humanText(d)}});
  await tx.humanEditorialDraft.update({where:{id:d.id},data:{status:'APPROVED',approvedBy:actor,approvedAt:new Date(),approvalNote:input.note}});
  await tx.auditLog.create({data:{actor,action:'HUMAN_EDIT_APPROVED',entityType:'Publication',entityId:p.id,message:'Editor explicitly approves human-authored revision, not failed AI output',metadata:json({draftId:d.id,revision:d.revision,note:input.note,digest:input.digest,originalSnapshot:d.originalSnapshot})}});
  return p;
 });
}
