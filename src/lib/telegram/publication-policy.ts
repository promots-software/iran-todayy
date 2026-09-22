import {Prisma} from '@prisma/client';
import {validateUnderstanding,sourceProfileSchema} from '../processing/contracts';
import {assertDirectFullCoverage} from '../processing/direct-bilingual';
import {editorialScope} from '../processing/editorial-scope';
import type {AutoPolicy} from './auto-policy';

export const publicationCandidateInclude={humanDraft:true,publication:true,eventRevision:true,evidence:{include:{sourcePost:{include:{source:true,jobs:true,matches:true,humanDraft:true}}}}} satisfies Prisma.NewsItemInclude;
export type PublicationCandidate=Prisma.NewsItemGetPayload<{include:typeof publicationCandidateInclude}>;
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const clean=(value:unknown,mode:unknown)=>{const r=record(value);return r.processingMode===mode&&r.validated===true&&r.editorialEligibility==='READY_TO_PUBLISH'&&Array.isArray(r.review)&&r.review.length===0;};

/** Only immutable factual contributors authorize a publication. A later duplicate
 * may be linked for traceability, but cannot authorize or veto the original text. */
export function publicationContributors(item:PublicationCandidate){
 if(!Array.isArray(item.factualEvidence)||!item.factualEvidence.length)return [];
 const ids=item.factualEvidence.map(f=>record(record(f).evidence).sourcePostId);
 if(ids.some(id=>typeof id!=='string'||!item.evidence.some(e=>e.sourcePostId===id)))return [];
 return item.evidence.filter(e=>ids.includes(e.sourcePostId)).map(e=>e.sourcePost);
}

/** Processing receipts are revalidated here, not used to select AUTO versus manual.
 * NORMAL scope and DIRECT full-source coverage remain distinct processing contracts. */
export function publicationReady(item:PublicationCandidate,frozen=false){
 const mode=record(item.validationResult).processingMode;
 if(!['NORMAL','DIRECT'].includes(String(mode))||item.status!==(frozen?'APPROVED':'PENDING_APPROVAL')||item.validationStatus!=='PASSED'||item.error||item.rejectionReason||item.needsReviewReasons.length||item.humanDraft||(!frozen&&item.publication)||!clean(item.validationResult,mode))return false;
 const contributors=publicationContributors(item);if(!contributors.length)return false;
 for(const post of contributors){
  const result=record(post.processingResult),profile=sourceProfileSchema.safeParse(post.source.editorialProfile);
  if(post.source.processingMode!==mode||!post.source.enabled||post.source.deletedAt||post.source.platform!=='TELEGRAM'||!profile.success||!profile.data.verified||profile.data.flagged||post.humanDraft||post.status!=='PENDING_APPROVAL'||post.error||post.rejectionReason||!clean(result,mode))return false;
  if(!post.jobs.length||post.jobs.some(j=>j.status!=='COMPLETED')||result.eventRevisionId!==item.eventRevisionId||!['NEW_EVENT','MATERIAL_UPDATE'].includes(String(result.classification))||!post.matches.some(m=>m.eventRevisionId===item.eventRevisionId&&['NEW_EVENT','MATERIAL_UPDATE'].includes(m.classification))||post.matches.some(m=>['UNCERTAIN','UNCERTAIN_MATCH'].includes(m.classification)))return false;
  try{
   const u=validateUnderstanding(result.extraction,post.originalContent);
   if(mode==='DIRECT')assertDirectFullCoverage(post.originalContent,u);
   else if(post.relevance!=='POLITICAL_NEWS'||editorialScope(post.originalContent).status!=='IN_SCOPE'||u.relevance!=='POLITICAL_NEWS'||u.filterReason!=='NONE'||u.priority==='P4')return false;
  }catch{return false;}
 }
 return true;
}

/** One delivery policy for all successfully processed stories. Environment gates
 * are enforced by requireAutoPolicy at decision AND durable send-claim time. */
export function eligibleAutomatic(item:PublicationCandidate,policy:AutoPolicy,frozen=false){
 if(!publicationReady(item,frozen))return false;
 const since=new Date(policy.notBefore);
 return policy.state!=='CLOSED'&&item.createdAt>=since&&(policy.state!=='CANARY'||policy.canaryCandidateId===item.id)&&publicationContributors(item).every(p=>{const activation=policy.sourceNotBefore?.[p.sourceId];if(policy.sourceNotBefore&&!activation)return false;const boundary=new Date(Math.max(since.getTime(),activation?new Date(activation).getTime():0));return policy.sourceIds.includes(p.sourceId)&&p.ingestedAt>=boundary&&p.sourcePublishedAt>=boundary;});
}
