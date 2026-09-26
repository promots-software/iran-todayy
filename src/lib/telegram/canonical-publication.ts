import {isDeepStrictEqual} from 'node:util';
import {assertCanonicalApproval,type CanonicalResult,canonicalDigest} from '../processing/canonical-flow';
import {eventSchema,ProcessingError,validateUnderstanding} from '../processing/contracts';
import {processingSource} from '../processing/processing-source';
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export type CanonicalPublicationItem={title:string;arabicContent:string|null;eventRevisionId:string;factualEvidence:unknown;validationResult:unknown;eventRevision:{facts:unknown};evidence:{sourcePost:{id:string;originalContent:string;normalizedContent?:string|null;processingResult:unknown}}[]};
/** Persisted canonical approval is checked for immutable integrity, not sent
 * through a second editorial model or legacy editorial receipt validator. */
export function canonicalPublicationFacts(item:CanonicalPublicationItem){
 const approval=record(item.validationResult).canonicalApproval;if(!approval)return null;
 if(process.env.IRAN_TODAY_ENVIRONMENT!=='staging')throw new ProcessingError('STAGING_CANONICAL_FLOW_REQUIRED');
 const current=eventSchema.shape.facts.parse(item.factualEvidence);
 if(current.length!==1)throw new ProcessingError('FACT_EVIDENCE_CHANGED');
 const post=item.evidence.find(e=>e.sourcePost.id===current[0].evidence.sourcePostId)?.sourcePost;
 if(!post)throw new ProcessingError('SOURCE_PROVENANCE_REQUIRED');
 const receipt=record(post.processingResult),source=processingSource(post);
 if(receipt.validated!==true||receipt.eventRevisionId!==item.eventRevisionId||!isDeepStrictEqual(receipt.canonicalApproval,approval))throw new ProcessingError('CANONICAL_APPROVAL_CHANGED');
 assertCanonicalApproval(approval as CanonicalResult,source,{title:item.title,body:item.arabicContent??''});
 const extraction=validateUnderstanding(receipt.extraction,source),revision=eventSchema.parse(item.eventRevision.facts);
 if(!isDeepStrictEqual(current,extraction.event.facts)||current[0].key!==canonicalDigest(source)||current[0].evidence.start!==0||current[0].evidence.end!==source.length||!revision.facts.some(f=>isDeepStrictEqual(f,current[0])))throw new ProcessingError('FACT_EVIDENCE_CHANGED');
 return current;
}
