import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Prisma,type PrismaClient,type NewsItem} from '@prisma/client';
import {z} from 'zod';
import {assertApprovalMode} from '../processing/shadow';
import {checkEvidence,eventSchema,ProcessingError} from '../processing/contracts';
import {renderPublicationText} from '../publication-text';

import {matchesHumanPublication,humanText,lockEditorialPublication} from '../human-editorial-contract';

const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
const humanReview=new Set(['UNVERIFIED_SOURCE','FLAGGED_SOURCE','SERIOUS_CLAIM','RANK_UNVERIFIED','UNCOVERED_TERM','UNKNOWN_NAME','EDITORIAL_ATTESTATION_REQUIRED','SHADOW_MODE_REVIEW','SENSITIVE_ACTOR','LEADER_STATUS','SINGLE_UNOFFICIAL_FIGURE']);
const validationSchema=z.object({review:z.array(z.object({code:z.string(),detail:z.string().optional()})),sentenceEvidence:z.array(z.object({text:z.string().min(1),factIds:z.array(z.string()).min(1)})).min(1)});
export function reviewKey(r:{code:string;detail?:string}){return `${r.code}:${r.detail??''}`;}
export function approvalDigest(item:Pick<NewsItem,'id'|'title'|'arabicContent'|'factualEvidence'|'validationResult'|'eventRevisionId'>){
 return createHash('sha256').update(JSON.stringify([item.id,item.eventRevisionId,item.title,item.arabicContent,item.factualEvidence,item.validationResult])).digest('hex');
}
export function publicationText(item:Pick<NewsItem,'title'|'arabicContent'>){
 if(item.arabicContent===null||!item.title.trim())throw new ProcessingError('NO_PUBLICATION_CONTENT');
 const text=renderPublicationText(item.title,item.arabicContent);
 if(text.length>4096)throw new ProcessingError('TELEGRAM_TEXT_TOO_LONG');
 return text;
}
/** Only a terminal hashtag-only block is outside sentence provenance. */
export function publicationBodyForProvenance(body:string){
 const split=body.lastIndexOf('\n\n');
 if(split<0)return body;
 const suffix=body.slice(split+2);
 return /^#[\p{L}\p{N}_]+(?: #[\p{L}\p{N}_]+){0,4}$/u.test(suffix)?body.slice(0,split):body;
}
export function readPublisherEnv(env:Record<string,string|undefined>=process.env){
 const token=env.TELEGRAM_BOT_TOKEN,chatId=env.TELEGRAM_CHAT_ID;
 if(!token||!/^\d+:[A-Za-z0-9_-]+$/.test(token)||!chatId||!/^-[1-9]\d*$/.test(chatId))throw new ProcessingError('TELEGRAM_PUBLISH_CONFIG_REQUIRED');
 return {token,chatId};
}
export function assertSendEnabled(env:Record<string,string|undefined>=process.env){
 if(env.TELEGRAM_PUBLISH_ENABLED!=='true'||env.SHADOW_MODE!=='false')throw new ProcessingError('TELEGRAM_PUBLISH_DISABLED');
}
export type ApprovalInput={newsItemId:string;digest:string;resolutions:{key:string;note:string}[]};
export async function approvePublication(db:PrismaClient,input:ApprovalInput,actor:string,env:Record<string,string|undefined>=process.env,target:'TELEGRAM'|'WEB'='TELEGRAM'){
 return db.$transaction(tx=>freezeValidatedPublication(tx,input,actor,env,target));
}
/** Shares the exact existing evidence/provenance freeze checks with a bounded automatic permit. */
export async function freezeValidatedPublication(tx:Prisma.TransactionClient,input:ApprovalInput,actor:string,env:Record<string,string|undefined>,target:'TELEGRAM'|'WEB'='TELEGRAM',automatic:boolean|'DIRECT'=false){
 if(!actor.trim())throw new ProcessingError('AUTHENTICATION_REQUIRED');
 const chatId=target==='WEB'?'WEB':readPublisherEnv(env).chatId; // Approving never calls Telegram and never arms sending.
  await lockEditorialPublication(tx);
  if(await tx.humanEditorialDraft.findUnique({where:{newsItemId:input.newsItemId}}))throw new ProcessingError('HUMAN_DRAFT_REQUIRES_HUMAN_APPROVAL');
  await tx.$queryRaw`SELECT id FROM "NewsItem" WHERE id=${input.newsItemId} FOR UPDATE`;
  assertApprovalMode((await tx.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode);
  const item=await tx.newsItem.findUniqueOrThrow({where:{id:input.newsItemId},include:{publication:true,eventRevision:true,evidence:{include:{sourcePost:true}}}});
  const digest=approvalDigest(item);
  if(digest!==input.digest)throw new ProcessingError('DRAFT_CHANGED_REVIEW_AGAIN');
  if(item.publication){if(item.publication.destination!==chatId)throw new ProcessingError('PUBLICATION_DESTINATION_LOCKED');if(item.publication.idempotencyKey===digest)return item.publication;throw new ProcessingError('PUBLICATION_ALREADY_EXISTS');}
  if(!['NEEDS_REVIEW','PENDING_APPROVAL'].includes(item.status)||!['NEEDS_REVIEW','PASSED'].includes(item.validationStatus)||item.error)throw new ProcessingError('DRAFT_NOT_APPROVABLE');
  const validation=validationSchema.parse(item.validationResult);
  if(validation.review.some(r=>!humanReview.has(r.code)))throw new ProcessingError('UNRESOLVED_VALIDATION_FAILURE');
  const required=[...new Set(validation.review.map(reviewKey))];
  if(input.resolutions.length!==required.length||new Set(input.resolutions.map(r=>r.key)).size!==required.length||input.resolutions.some(r=>!required.includes(r.key)||r.note.trim().length<10||r.note.length>3000))throw new ProcessingError('EXPLICIT_REVIEW_REQUIRED');
  const event=eventSchema.parse(item.eventRevision.facts);
  if(!event.facts.length||!isDeepStrictEqual(item.factualEvidence,event.facts))throw new ProcessingError('FACT_EVIDENCE_CHANGED');
  for(const fact of event.facts){
   const source=item.evidence.find(e=>e.sourcePostId===fact.evidence.sourcePostId)?.sourcePost;
   if(!source)throw new ProcessingError('SOURCE_PROVENANCE_REQUIRED');
   checkEvidence(source.originalContent,fact.evidence);
   if(fact.speaker)checkEvidence(source.originalContent,fact.speaker.evidence);
  }
  const content=publicationText(item),sentences=validation.sentenceEvidence;
  if(!sentences.some(s=>s.text===item.title))throw new ProcessingError('TITLE_PROVENANCE_REQUIRED');
  for(const s of sentences)if(!content.includes(s.text)||s.factIds.some(id=>!event.facts.some(f=>f.id===id)))throw new ProcessingError('INVALID_DRAFT_FACT_LINK');
  let remainder=`${item.title}\n${publicationBodyForProvenance(item.arabicContent!)}`;
  for(const s of [...sentences].sort((a,b)=>b.text.length-a.text.length))remainder=remainder.split(s.text).join('');
  if(remainder.trim())throw new ProcessingError('INCOMPLETE_DRAFT_PROVENANCE');
  const publication=await tx.publication.create({data:{newsItemId:item.id,idempotencyKey:digest,contentSnapshot:content,destination:chatId}});
  await tx.newsItem.update({where:{id:item.id},data:{status:'APPROVED',approvedAt:new Date(),approvedBy:actor}});
  await tx.auditLog.create({data:{action:automatic==='DIRECT'?'DIRECT_AUTO_PUBLICATION_APPROVED':automatic?'CONTROLLED_AUTO_PUBLICATION_APPROVED':'MANUAL_PUBLICATION_APPROVED',actor,entityType:'Publication',entityId:publication.id,message:automatic?'Clean validated READY content frozen under one-shot authorization; no message sent':'Explicit review and approval of frozen content; no message sent',metadata:json({digest,resolutions:input.resolutions,review:validation.review})}});
  return publication;
}
export type SendResult={status:'SENT';messageId:string;chatId:string}|{status:'FAILED'|'UNKNOWN';error:string};
/** No automatic transport retry: Bot API has no client idempotency key. */
export async function sendTelegramOnce(config:{token:string;chatId:string},text:string,transport:typeof fetch=fetch):Promise<SendResult>{
 try{
  const response=await transport(`https://api.telegram.org/bot${config.token}/sendMessage`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:config.chatId,text,link_preview_options:{is_disabled:true},allow_paid_broadcast:false})});
  const data=await response.json();
  if(response.ok&&data.ok===true&&Number.isSafeInteger(data.result?.message_id)&&data.result.message_id>0&&String(data.result.chat?.id)===config.chatId)return {status:'SENT',messageId:String(data.result.message_id),chatId:config.chatId};
  if(data.ok===false&&[400,401,403,404,429].includes(data.error_code))return {status:'FAILED',error:`TELEGRAM_REJECTED_${data.error_code}`};
  return {status:'UNKNOWN',error:'TELEGRAM_DELIVERY_UNCERTAIN'};
 }catch{return {status:'UNKNOWN',error:'TELEGRAM_DELIVERY_UNCERTAIN'};}
}
export type ManualSendInput={publicationId:string;digest:string;destination:string;confirmed:boolean};
export function assertManualSendEnabled(env:Record<string,string|undefined>){
 if(env.TELEGRAM_MANUAL_PUBLISH_ENABLED!=='true'||env.AUTO_PUBLISH!=='false'||env.REQUIRE_APPROVAL!=='true'||env.SHADOW_MODE!=='true')throw new ProcessingError('MANUAL_PUBLISH_DISABLED');
}
/** Called only after dashboard authentication; never changes process-wide safeguards. */
export async function publishApprovedManually(db:PrismaClient,input:ManualSendInput,actor:string,env:Record<string,string|undefined>=process.env,transport:typeof fetch=fetch){
 if(!actor.trim())throw new ProcessingError('AUTHENTICATION_REQUIRED');
 if(!input.confirmed)throw new ProcessingError('EXPLICIT_SEND_REQUIRED');
 assertManualSendEnabled(env);
 return deliverClaimedPublication(db,input.publicationId,env,transport,{...input,actor});
}
export async function publishOne(db:PrismaClient,id:string,env:Record<string,string|undefined>=process.env,transport:typeof fetch=fetch){
 assertSendEnabled(env);
 return deliverClaimedPublication(db,id,env,transport);
}
async function deliverClaimedPublication(db:PrismaClient,id:string,env:Record<string,string|undefined>,transport:typeof fetch,manual?:ManualSendInput & {actor:string}){
 const config=readPublisherEnv(env);
 const intent=await db.$transaction(async tx=>{
  assertApprovalMode((await tx.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode);
  await lockEditorialPublication(tx);
  const p=await tx.publication.findUniqueOrThrow({where:{id},include:{newsItem:true,humanDraft:true}});
  if(p.humanDraft&&!manual)throw new ProcessingError('HUMAN_PUBLICATION_MANUAL_ONLY');
  if(manual&&(p.idempotencyKey!==manual.digest||p.destination!==manual.destination))throw new ProcessingError('PUBLICATION_PREVIEW_CHANGED');
  if(p.status!=='PENDING')return null; // SENT / UNKNOWN / FAILED / SENDING are never retried implicitly.
  if(p.humanDraft){
   const d=p.humanDraft;
   if(d.status!=='APPROVED'||!d.approvedBy||!d.approvedAt||p.destination!==config.chatId||!matchesHumanPublication(d,p)||p.contentSnapshot!==humanText(d))throw new ProcessingError('APPROVAL_OR_CONTENT_CHANGED');
  }else if(!p.newsItem||p.destination!==config.chatId||p.newsItem.status!=='APPROVED'||!['PASSED','NEEDS_REVIEW'].includes(p.newsItem.validationStatus)||p.newsItem.error||!p.newsItem.approvedAt||!p.newsItem.approvedBy||p.idempotencyKey!==approvalDigest(p.newsItem)||p.contentSnapshot!==publicationText(p.newsItem))throw new ProcessingError('APPROVAL_OR_CONTENT_CHANGED');
  const claimed=await tx.publication.updateMany({where:{id,status:'PENDING',attemptCount:0},data:{status:'SENDING',attemptCount:1,claimedAt:new Date(),nextRetryAt:null}});
  if(!claimed.count)return null;
  await tx.publicationAttempt.create({data:{publicationId:id,attempt:1}});
  await tx.auditLog.create({data:{action:'PUBLICATION_SEND_STARTED',actor:manual?.actor,entityType:'Publication',entityId:id,message:'Durable single-send claim recorded'}});
  return p;
 });
 if(!intent)return {status:'NOT_SENT_ALREADY_CLAIMED'};
 const outcome=await sendTelegramOnce(config,intent.contentSnapshot,transport);
 // If persisting the result fails after Telegram accepted the message, SENDING
 // remains a stop state. Never resend to recover a lost acknowledgement.
 await db.$transaction(async tx=>{
  const changed=await tx.publication.updateMany({where:{id,status:'SENDING',attemptCount:1},data:{status:outcome.status,telegramMessageId:outcome.status==='SENT'?outcome.messageId:null,telegramResult:json(outcome),error:outcome.status==='SENT'?null:outcome.error,sentAt:outcome.status==='SENT'?new Date():null}});
  if(changed.count!==1)throw new ProcessingError('PUBLICATION_STATE_CHANGED');
  await tx.publicationAttempt.update({where:{publicationId_attempt:{publicationId:id,attempt:1}},data:{finishedAt:new Date(),result:json(outcome),error:outcome.status==='SENT'?null:outcome.error}});
  if(intent.newsItemId)await tx.newsItem.update({where:{id:intent.newsItemId},data:{status:outcome.status==='SENT'?'PUBLISHED':'APPROVED'}});
  if(intent.humanDraftId&&outcome.status==='SENT')await tx.humanEditorialDraft.update({where:{id:intent.humanDraftId},data:{status:'PUBLISHED'}});
  await tx.auditLog.create({data:{action:`PUBLICATION_${outcome.status}`,actor:manual?.actor,entityType:'Publication',entityId:id,message:outcome.status==='SENT'?'Telegram message ID persisted':'Delivery stopped; operator reconciliation required',metadata:json(outcome)}});
 });
 return outcome;
}
