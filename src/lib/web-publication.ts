import type {PrismaClient} from '@prisma/client';
import {lockEditorialPublication,matchesHumanPublication,humanText} from './human-editorial-contract';
import {approvalDigest,publicationText} from './telegram/publisher';
import {assertApprovalMode} from './processing/shadow';
export async function publishWeb(db:PrismaClient,input:{id:string;digest:string;confirmed:boolean},actor:string){
 if(!actor.trim()||!input.confirmed)throw new Error('EXPLICIT_APPROVAL_REQUIRED');
 return db.$transaction(async tx=>{
  await lockEditorialPublication(tx);assertApprovalMode((await tx.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode);
  const p=await tx.publication.findUniqueOrThrow({where:{id:input.id},include:{humanDraft:true,newsItem:true}});
  if(p.destination!=='WEB'||p.idempotencyKey!==input.digest)throw new Error('PREVIEW_CHANGED');
  if(p.status==='SENT')return p;
  if(p.status!=='PENDING'||p.attemptCount!==0)throw new Error('PUBLICATION_LOCKED');
  if(p.humanDraft){const d=p.humanDraft;if(d.status!=='APPROVED'||!d.approvedAt||!d.approvedBy||!matchesHumanPublication(d,p)||humanText(d)!==p.contentSnapshot||(d.publicationImageId??null)!==(p.publicationImageId??null))throw new Error('APPROVAL_CHANGED');}
  else{const n=p.newsItem;if(!n||n.status!=='APPROVED'||!n.approvedAt||!n.approvedBy||n.error||!['PASSED','NEEDS_REVIEW'].includes(n.validationStatus)||approvalDigest(n)!==p.idempotencyKey||publicationText(n)!==p.contentSnapshot||p.publicationImageId)throw new Error('APPROVAL_CHANGED');}
  const result=await tx.publication.update({where:{id:p.id},data:{status:'SENT',sentAt:new Date(),attemptCount:1}});
  await tx.publicationAttempt.create({data:{publicationId:p.id,attempt:1,finishedAt:new Date(),result:{destination:'WEB'}}});
  if(p.newsItemId)await tx.newsItem.update({where:{id:p.newsItemId},data:{status:'PUBLISHED'}});
  if(p.humanDraftId)await tx.humanEditorialDraft.update({where:{id:p.humanDraftId},data:{status:'PUBLISHED'}});
  await tx.auditLog.create({data:{actor,action:'WEB_PUBLICATION_PUBLISHED',entityType:'Publication',entityId:p.id,message:'نشر النسخة المعتمدة على الويب',metadata:{digest:p.idempotencyKey,publicationImageId:p.publicationImageId}}});return result;
 });
}
