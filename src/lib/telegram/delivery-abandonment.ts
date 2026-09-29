import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Operational cancellation is separate from the immutable UNKNOWN transport outcome. */
export async function abandonUnknownDelivery(tx:Prisma.TransactionClient,id:string,expected:string,actor:string,policyId:string){
 const p=await tx.publication.findUniqueOrThrow({where:{id},include:{attempts:true}});
 const a=p.attempts[0];
 if(p.updatedAt.toISOString()!==expected||p.automaticPolicyId!==policyId||p.status!=='UNKNOWN'||p.attemptCount!==1||p.attempts.length!==1||!a.finishedAt||p.telegramMessageId||p.sentAt)throw Error('ABANDON_REQUIRES_TERMINAL_UNKNOWN');
 const receipt=a.result as {digest?:string;outcome?:{status?:string}}|null;
 if(a.attempt!==1||receipt?.digest!==p.idempotencyKey||receipt?.outcome?.status!=='UNKNOWN'||(p.telegramResult as {status?:string}|null)?.status!=='UNKNOWN')throw Error('ABANDON_REQUIRES_TERMINAL_UNKNOWN');
 await tx.auditLog.create({data:{id:`delivery-abandoned:${id}`,actor,action:'PUBLICATION_DELIVERY_ABANDONED',entityType:'Publication',entityId:id,message:'Owner abandons recovery; historical delivery remains UNKNOWN; never resend',metadata:{resolution:'ABANDONED',historicalOutcome:'UNKNOWN',policyId,destination:p.destination,digest:p.idempotencyKey,attemptId:a.id,attemptResultHash:hash(a.result),telegramResultHash:hash(p.telegramResult)}}});
 await tx.publication.update({where:{id},data:{status:'CANCELLED',error:'OWNER_ABANDONED_UNCERTAIN_DELIVERY',nextRetryAt:null}});
}

/** Must be called under the shared editorial publication lock. */
export async function assertResolvedDeliveries(tx:Prisma.TransactionClient,policyId?:string){
 const scope=policyId?{automaticPolicyId:policyId}:{automaticPolicyId:{not:null}};
 if(await tx.publication.count({where:{...scope,status:{in:['PENDING','SENDING','UNKNOWN','FAILED']}}}))throw Error('DELIVERY_RECONCILIATION_REQUIRED');
 const cancelled=await tx.publication.findMany({where:{...scope,status:'CANCELLED'},include:{attempts:true}});
 for(const p of cancelled){
  if(p.attemptCount===0&&!p.attempts.length&&!p.telegramMessageId&&!p.claimedAt&&!p.sentAt)continue;
  const audit=await tx.auditLog.findUnique({where:{id:`delivery-abandoned:${p.id}`}}),m=audit?.metadata as Record<string,unknown>|null;
  const a=p.attempts[0];
  if(p.error!=='OWNER_ABANDONED_UNCERTAIN_DELIVERY'||p.attemptCount!==1||p.attempts.length!==1||!a.finishedAt||p.telegramMessageId||p.sentAt||audit?.action!=='PUBLICATION_DELIVERY_ABANDONED'||m?.resolution!=='ABANDONED'||m.historicalOutcome!=='UNKNOWN'||m.policyId!==p.automaticPolicyId||m.destination!==p.destination||m.digest!==p.idempotencyKey||m.attemptId!==a.id||m.attemptResultHash!==hash(a.result)||m.telegramResultHash!==hash(p.telegramResult)||(a.result as {outcome?:{status?:string}}|null)?.outcome?.status!=='UNKNOWN')throw Error('DELIVERY_RECONCILIATION_REQUIRED');
 }
}
