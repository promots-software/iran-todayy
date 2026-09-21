import {assertDirectFullCoverage} from '../processing/direct-bilingual';
import {Prisma,type PrismaClient} from '@prisma/client';
import {ProcessingError,validateUnderstanding,sourceProfileSchema} from '../processing/contracts';
import {lockEditorialPublication} from '../human-editorial-contract';
import {approvalDigest,freezeValidatedPublication,publishOne,assertSendEnabled,readPublisherEnv} from './publisher';
const include={humanDraft:true,publication:true,eventRevision:true,evidence:{include:{sourcePost:{include:{source:true,jobs:true,matches:true,humanDraft:true}}}}} satisfies Prisma.NewsItemInclude;
type Candidate=Prisma.NewsItemGetPayload<{include:typeof include}>;
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
function clean(value:unknown){const r=record(value);return r.processingMode==='DIRECT'&&r.validated===true&&r.editorialEligibility==='READY_TO_PUBLISH'&&Array.isArray(r.review)&&r.review.length===0;}
function sourceAllowsDirect(source:Candidate['evidence'][number]['sourcePost']['source']) {
 const profile=sourceProfileSchema.safeParse(source.editorialProfile);
 return source.processingMode==='DIRECT'&&source.enabled&&!source.deletedAt&&source.platform==='TELEGRAM'&&profile.success&&profile.data.verified&&!profile.data.flagged&&profile.data.classification!=='UNKNOWN';
}
/** DIRECT grants scope, never human-edit approval or authority over failed AI output. */
export function eligibleDirectPublication(item:Candidate){
 if(item.status!=='PENDING_APPROVAL'||item.validationStatus!=='PASSED'||item.error||item.rejectionReason||item.needsReviewReasons.length||item.humanDraft||item.publication||!clean(item.validationResult)||!item.evidence.length)return false;
 for(const {sourcePost:p} of item.evidence){
  const result=record(p.processingResult);
  if(!sourceAllowsDirect(p.source)||p.humanDraft||p.status!=='PENDING_APPROVAL'||p.error||p.rejectionReason||!clean(result)||!p.jobs.length||p.jobs.some(j=>j.status!=='COMPLETED'))return false;
  if(result.eventRevisionId!==item.eventRevisionId||!['NEW_EVENT','MATERIAL_UPDATE'].includes(String(result.classification))||!p.matches.some(m=>m.eventRevisionId===item.eventRevisionId&&['NEW_EVENT','MATERIAL_UPDATE'].includes(m.classification))||p.matches.some(m=>['UNCERTAIN','UNCERTAIN_MATCH'].includes(m.classification)))return false;
  try{const understanding=validateUnderstanding(result.extraction,p.originalContent);assertDirectFullCoverage(p.originalContent,understanding);}catch{return false;}
 }
 return true;
}
export function assertDirectAutoEnabled(env:Record<string,string|undefined>){
 // Never disable REQUIRE_APPROVAL: this exception applies only to clean original
 // AI output whose source administrator explicitly granted DIRECT scope.
 if(env.AUTO_PUBLISH!=='true'||env.REQUIRE_APPROVAL!=='true')throw new ProcessingError('DIRECT_AUTO_DISABLED');
 assertSendEnabled(env);readPublisherEnv(env);
}
/** Separate delivery entry point. Processing worker remains draft-only.
 * A crash after freeze leaves PENDING for reconciliation, never an implicit resend. */
export async function publishReadyDirect(db:PrismaClient,id:string,env:Record<string,string|undefined>,transport:typeof fetch=fetch){
 assertDirectAutoEnabled(env);
 const publication=await db.$transaction(async tx=>{
  await lockEditorialPublication(tx);
  const item=await tx.newsItem.findUnique({where:{id},include});
  if(!item)return null;
  for(const sourceId of [...new Set(item.evidence.map(e=>e.sourcePost.sourceId))].sort())await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${sourceId} FOR SHARE`;
  const current=await tx.newsItem.findUniqueOrThrow({where:{id},include});
  if(!eligibleDirectPublication(current))return null;
  return freezeValidatedPublication(tx,{newsItemId:id,digest:approvalDigest(current),resolutions:[]},'direct-auto-publisher',env,'TELEGRAM','DIRECT');
 },{timeout:30000});
 if(!publication)return {status:'NOT_ELIGIBLE' as const};
 // Recheck flags immediately before the existing durable single-send claim.
 assertDirectAutoEnabled(env);
 const guarded:typeof fetch=async(url,init)=>{
  assertDirectAutoEnabled(env);
  const item=await db.newsItem.findUniqueOrThrow({where:{id},include});
  if(item.humanDraft||item.evidence.some(e=>e.sourcePost.humanDraft||!sourceAllowsDirect(e.sourcePost.source)))throw new ProcessingError('DIRECT_AUTHORIZATION_CHANGED');
  return transport(url,init);
 };
 return publishOne(db,publication.id,env,guarded);
}
