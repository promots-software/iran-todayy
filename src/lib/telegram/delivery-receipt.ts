import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {ProcessingError} from '../processing/contracts';
import {lockEditorialPublication} from '../human-editorial-contract';
import type {SendResult} from './publisher';
const outcomeSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('SENT'),messageId:z.string().regex(/^[1-9]\d*$/),chatId:z.string().regex(/^-[1-9]\d*$/)}).strict(),
 z.object({status:z.enum(['FAILED','UNKNOWN']),error:z.string().regex(/^[A-Z_0-9]+$/)}).strict(),
]);
const receiptSchema=z.object({version:z.literal('telegram-ack-v1'),digest:z.string(),receivedAt:z.iso.datetime(),outcome:outcomeSchema}).strict();
const json=(x:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(x));
/** Retries persistence only. Never receives a network/send callback. */
export async function retryPersistence<T>(work:()=>Promise<T>){let error:unknown;for(let i=0;i<3;i++){try{return await work();}catch(e){error=e;}}throw error;}
export async function recordDeliveryReceipt(db:PrismaClient,id:string,digest:string,outcome:SendResult){
 const receipt=receiptSchema.parse({version:'telegram-ack-v1',digest,receivedAt:new Date().toISOString(),outcome});
 await retryPersistence(async()=>{
  const changed=await db.publicationAttempt.updateMany({where:{publicationId:id,attempt:1,finishedAt:null,result:{equals:Prisma.DbNull}},data:{result:json(receipt),finishedAt:new Date(receipt.receivedAt),error:outcome.status==='SENT'?null:outcome.error}});
  if(changed.count)return;
  const prior=receiptSchema.safeParse((await db.publicationAttempt.findUniqueOrThrow({where:{publicationId_attempt:{publicationId:id,attempt:1}}})).result);
  if(!prior.success||prior.data.digest!==digest||!isDeepStrictEqual(prior.data.outcome,outcome))throw new ProcessingError('DELIVERY_RECEIPT_CONFLICT');
 });
}
/** Recovery consumes a durable acknowledgement; no transport or provider is used. */
export async function reconcileDelivery(db:PrismaClient,id:string,actor='telegram-reconciler',now=new Date()){
 return db.$transaction(async tx=>{
  await lockEditorialPublication(tx);
  const p=await tx.publication.findUniqueOrThrow({where:{id},include:{attempts:true}});
  if(!['SENDING','UNKNOWN'].includes(p.status))return {status:p.status,changed:false};
  const attempt=p.attempts.find(a=>a.attempt===1),parsed=receiptSchema.safeParse(attempt?.result);
  if(!parsed.success){
   if(p.status==='SENDING'&&p.claimedAt&&now.getTime()-p.claimedAt.getTime()>=120000){
    await tx.publication.update({where:{id},data:{status:'UNKNOWN',error:'TELEGRAM_ACKNOWLEDGEMENT_NOT_DURABLE'}});
    await tx.auditLog.create({data:{id:`delivery-uncertain:${id}`,actor,action:'PUBLICATION_UNKNOWN',entityType:'Publication',entityId:id,message:'Claim has no durable acknowledgement; never resend. Operator evidence required.'}});
    return {status:'UNKNOWN',changed:true};
   }
   return {status:p.status,changed:false};
  }
  const r=parsed.data,o=r.outcome;
  if(p.attemptCount!==1||r.digest!==p.idempotencyKey||(o.status==='SENT'&&o.chatId!==p.destination))throw new ProcessingError('DELIVERY_RECEIPT_CONFLICT');
  // UNKNOWN is terminal for transport but remains in the recovery scan. Its
  // already reconciled receipt must be a no-op, including the durable audit.
  const prior=await tx.auditLog.findUnique({where:{id:`delivery-final:${id}`}});
  if(prior){
   if(p.status!==o.status||!isDeepStrictEqual(p.telegramResult,o)||!isDeepStrictEqual(prior.metadata,o))throw new ProcessingError('DELIVERY_RECEIPT_CONFLICT');
   return {...o,changed:false};
  }
  await tx.publication.update({where:{id},data:{status:o.status,telegramMessageId:o.status==='SENT'?o.messageId:null,telegramResult:json(o),error:o.status==='SENT'?null:o.error,sentAt:o.status==='SENT'?new Date(r.receivedAt):null}});
  if(p.newsItemId)await tx.newsItem.update({where:{id:p.newsItemId},data:{status:o.status==='SENT'?'PUBLISHED':'APPROVED'}});
  if(p.humanDraftId&&o.status==='SENT')await tx.humanEditorialDraft.update({where:{id:p.humanDraftId},data:{status:'PUBLISHED'}});
  await tx.auditLog.create({data:{id:`delivery-final:${id}`,actor,action:`PUBLICATION_${o.status}`,entityType:'Publication',entityId:id,message:o.status==='SENT'?'Durable Telegram acknowledgement reconciled; no repeated send':'Delivery stopped; never retry transport',metadata:json(o)}});
  return {...o,changed:true};
 },{timeout:30000});
}
