import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {lockEditorialPublication} from '../human-editorial-contract';
import {autoPolicySchema,type AutoPolicy} from './auto-policy';
import {ProcessingError} from '../processing/contracts';
/** Explicit operator action, never called by startup/build or ordinary page reads. */
export async function armAutomaticPolicy(db:PrismaClient,input:{state:'CANARY'|'ACTIVE';destination:string;notBefore:Date;sourceIds:string[];canaryCandidateId:string|null;priorCanaryId?:string},actor:string){
 return db.$transaction(async tx=>{
  await lockEditorialPublication(tx);const settings=await tx.appSettings.findUniqueOrThrow({where:{id:1}});
  const old=autoPolicySchema.safeParse(settings.telegramAutoPolicy);
  if(old.success&&old.data.state!=='CLOSED')throw new ProcessingError('AUTOMATIC_POLICY_ALREADY_ACTIVE');
  if(!actor||settings.publishingPaused||settings.publishingMode!=='REQUIRE_APPROVAL')throw new ProcessingError('AUTOMATIC_POLICY_SAFETY_REQUIRED');
  const sources=await tx.source.findMany({where:{id:{in:input.sourceIds},enabled:true,deletedAt:null,platform:'TELEGRAM'}});
  if(sources.length!==new Set(input.sourceIds).size)throw new ProcessingError('AUTOMATIC_SOURCE_INVALID');
  if(input.state==='ACTIVE'){
   if(!old.success||old.data.state!=='CLOSED'||old.data.reason!=='CANARY_COMPLETE'||old.data.id!==input.priorCanaryId)throw new ProcessingError('VERIFIED_CANARY_REQUIRED');
   const sent=await tx.publication.findMany({where:{automaticPolicyId:old.data.id},include:{attempts:true}});
   if(sent.length!==1||sent[0].status!=='SENT'||!sent[0].telegramMessageId||sent[0].destination!==input.destination||sent[0].attempts.length!==1||!sent[0].attempts[0].result||!await tx.auditLog.count({where:{entityId:sent[0].id,action:'PUBLICATION_SENT'}}))throw new ProcessingError('VERIFIED_CANARY_REQUIRED');
  }
  const policy:AutoPolicy=autoPolicySchema.parse({version:'telegram-auto-v1',id:randomUUID(),state:input.state,destination:input.destination,notBefore:input.notBefore.toISOString(),sourceIds:input.sourceIds,canaryCandidateId:input.canaryCandidateId,authorizedBy:actor});
  if(policy.state==='CANARY'&&!policy.canaryCandidateId)throw new ProcessingError('CANARY_CANDIDATE_REQUIRED');
  await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
  await tx.auditLog.create({data:{actor,action:'AUTOMATIC_DELIVERY_AUTHORIZED',entityType:'AppSettings',entityId:'1',message:'Explicit source/destination/time-bounded eligibility authorization; no delivery in this action',metadata:{policy,previousPolicyId:old.success?old.data.id:null}}});return policy;
 },{timeout:30000});
}
