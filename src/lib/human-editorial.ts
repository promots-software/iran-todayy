import {formatTelegram} from './telegram/format';
import {sourceHasMedia} from './publication-media';
import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {ProcessingError} from './processing/contracts';
import {assertApprovalMode} from './processing/shadow';
import {humanDigest,humanText,lockEditorialPublication,humanPublicationDigest,matchesHumanPublication} from './human-editorial-contract';
import {readPublisherEnv} from './telegram/publisher';
import {publicationParts} from './publication-text';
import {finalizeBodyPunctuation} from './publication-finalization';
const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
const targetSchema=z.object({kind:z.enum(['post','news']),id:z.string().min(1).max(100)});
export type EditorialTarget=z.infer<typeof targetSchema>;
async function origin(tx:Prisma.TransactionClient,target:EditorialTarget){
 if(target.kind==='news'){
  const item=await tx.newsItem.findUniqueOrThrow({where:{id:target.id},include:{publication:true,evidence:{include:{sourcePost:true}}}});
  if(item.rejectionReason==='HISTORICAL_INGESTION_RETIRED'||item.evidence.some(e=>e.sourcePost.rejectionReason==='HISTORICAL_INGESTION_RETIRED'))throw new ProcessingError('HISTORICAL_INGESTION_RETIRED');
  if(item.publication)throw new ProcessingError('EXISTING_AI_PUBLICATION_REQUIRES_RECONCILIATION');
  if(!['NEEDS_REVIEW','PENDING_APPROVAL','FAILED','REJECTED'].includes(item.status)||!item.evidence.length)throw new ProcessingError('ITEM_NOT_REVIEWABLE');
  return {where:{newsItemId:item.id},snapshot:item};
 }
 const post=await tx.sourcePost.findUniqueOrThrow({where:{id:target.id},include:{evidence:true,jobs:true}});
 if(post.rejectionReason==='HISTORICAL_INGESTION_RETIRED')throw new ProcessingError('HISTORICAL_INGESTION_RETIRED');
 if(post.evidence.length)throw new ProcessingError('EDIT_LINKED_NEWS_ITEM');
 if(!['NEEDS_REVIEW','FAILED','REJECTED'].includes(post.status))throw new ProcessingError('ITEM_NOT_REVIEWABLE');
 return {where:{sourcePostId:post.id},snapshot:post};
}
export async function saveHumanDraft(db:PrismaClient,input:EditorialTarget & {revision:number;title:string;body:string;publicationImageId?:string|null;mediaDecision?:boolean},actor:string){
 if(!actor.trim())throw new ProcessingError('AUTHENTICATION_REQUIRED');
 const target=targetSchema.parse(input);z.number().int().min(0).parse(input.revision);
 const raw={title:z.string().min(1).max(4096).parse(input.title),body:z.string().max(4096).parse(input.body)};humanText(raw);
 const text=publicationParts(raw.title,raw.body);
 text.body=finalizeBodyPunctuation(text.body);humanText(text);
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
export async function approveHumanDraft(db:PrismaClient,input:{id:string;digest:string;confirmed:boolean;note?:string},actor:string,env:Record<string,string|undefined>=process.env,target:'TELEGRAM'|'WEB'='TELEGRAM'){
 if(!actor.trim())throw new ProcessingError('AUTHENTICATION_REQUIRED');
 if(!input.confirmed)throw new ProcessingError('HUMAN_RESPONSIBILITY_REQUIRED');
 const note=z.string().max(5000).parse(input.note??'');
 const chatId=target==='WEB'?'WEB':readPublisherEnv(env).chatId;
 return db.$transaction(async tx=>{
  await lockEditorialPublication(tx);assertApprovalMode((await tx.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode);
  const d=await tx.humanEditorialDraft.findUniqueOrThrow({where:{id:input.id},include:{publications:true}});
  if(target==='TELEGRAM'&&d.publicationImageId)throw new ProcessingError('IMAGE_WEB_ONLY');
  if(humanDigest(d)!==input.digest)throw new ProcessingError('STALE_EDITORIAL_DRAFT');
  const existing=d.publications.find(p=>p.status!=='CANCELLED');
  if(existing){if(existing.destination!==chatId)throw new ProcessingError('PUBLICATION_DESTINATION_LOCKED');if(matchesHumanPublication(d,existing))return existing;throw new ProcessingError('PUBLICATION_LOCKED');}
  const original=await origin(tx,{kind:d.newsItemId?'news':'post',id:d.newsItemId??d.sourcePostId!});
  const snapshot=original.snapshot;
  const hasMedia='metadata' in snapshot?sourceHasMedia(snapshot.metadata):snapshot.evidence.some(e=>sourceHasMedia(e.sourcePost.metadata));
  // Telegram publishes only frozen text. Source attachments are never copied
  // into that publication and require no media-delivery decision.
  if(target!=='TELEGRAM'&&hasMedia&&!d.mediaDecisionAt)throw new ProcessingError('SOURCE_MEDIA_DECISION_REQUIRED');
  const telegramFormatSnapshot=target==='TELEGRAM'?formatTelegram(d.title,d.body):null;
  const p=await tx.publication.create({data:{...(telegramFormatSnapshot?{telegramFormatSnapshot:json(telegramFormatSnapshot)}:{}),humanDraftId:d.id,idempotencyKey:humanPublicationDigest(d,chatId,telegramFormatSnapshot),destination:chatId,publicationImageId:d.publicationImageId,contentSnapshot:humanText(d)}});
  await tx.humanEditorialDraft.update({where:{id:d.id},data:{status:'APPROVED',approvedBy:actor,approvedAt:new Date(),approvalNote:note}});
  await tx.auditLog.create({data:{actor,action:'HUMAN_EDIT_APPROVED',entityType:'Publication',entityId:p.id,message:'Editor explicitly approves human-authored revision, not failed AI output',metadata:json({draftId:d.id,revision:d.revision,note,digest:input.digest,publicationDigest:p.idempotencyKey,telegramFormatVersion:telegramFormatSnapshot?.version??null,originalSnapshot:d.originalSnapshot})}});
  return p;
 });
}

/** Explicit withdrawal only: never changes frozen text, destination or revision. */
export async function cancelUnsentHumanPublication(db:PrismaClient,input:{id:string;digest:string;confirmed:boolean},actor:string){
 if(!actor.trim()||!input.confirmed)throw new ProcessingError('EXPLICIT_CONFIRMATION_REQUIRED');
 return db.$transaction(async tx=>{
  await lockEditorialPublication(tx);assertApprovalMode((await tx.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode);
  const p=await tx.publication.findUniqueOrThrow({where:{id:input.id},include:{humanDraft:true,attempts:true}});
  if(!p.humanDraft||p.idempotencyKey!==input.digest)throw new ProcessingError('PUBLICATION_PREVIEW_CHANGED');
  if(p.status==='CANCELLED')return p;
  if(p.humanDraft.status!=='APPROVED'||!matchesHumanPublication(p.humanDraft,p)||p.status!=='PENDING'||p.attemptCount!==0||p.attempts.length||p.sentAt||p.telegramMessageId)throw new ProcessingError('PUBLICATION_LOCKED');
  const cancelled=await tx.publication.update({where:{id:p.id},data:{status:'CANCELLED',error:'HUMAN_DESTINATION_APPROVAL_WITHDRAWN'}});
  await tx.humanEditorialDraft.update({where:{id:p.humanDraft.id},data:{status:'DRAFT',approvedAt:null,approvedBy:null,approvalNote:null}});
  await tx.auditLog.create({data:{actor,action:'HUMAN_APPROVAL_INVALIDATED',entityType:'Publication',entityId:p.id,message:'Explicit withdrawal of unsent destination approval; frozen history preserved',metadata:json({destination:p.destination,digest:p.idempotencyKey,draftId:p.humanDraft.id,revision:p.humanDraft.revision,previousApprovedAt:p.humanDraft.approvedAt,previousApprovedBy:p.humanDraft.approvedBy,previousApprovalNote:p.humanDraft.approvalNote})}});
  return cancelled;
 });
}
