import {isDeepStrictEqual} from 'node:util';
import {eventSchema,ProcessingError,validateUnderstanding} from '../processing/contracts';

const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
type UpdateItem={eventRevisionId:string;factualEvidence:unknown;validationResult:unknown;eventRevision:{facts:unknown};evidence:{sourcePost:{id:string;originalContent:string;processingResult:unknown}}[]};
/** NORMAL updates publish the complete current extraction, not the historical
 * event union. Both receipts must retain every current fact exactly. */
export function normalMaterialUpdateFacts(item:UpdateItem){
 const validation=record(item.validationResult);
 if(validation.processingMode!=='NORMAL'||validation.format!=='UPDATE')return null;
 const receipts=item.evidence.map(e=>e.sourcePost).filter(post=>{
  const r=record(post.processingResult);
  return r.processingMode==='NORMAL'&&r.classification==='MATERIAL_UPDATE'&&r.eventRevisionId===item.eventRevisionId;
 });
 if(receipts.length!==1)throw new ProcessingError('FACT_EVIDENCE_CHANGED');
 const post=receipts[0],receipt=record(post.processingResult);
 const current=eventSchema.shape.facts.parse(item.factualEvidence);
 const extraction=validateUnderstanding(receipt.extraction,post.originalContent);
 const revision=eventSchema.parse(item.eventRevision.facts);
 if(receipt.validated!==true||!current.length||!isDeepStrictEqual(item.factualEvidence,current)||!isDeepStrictEqual(current,extraction.event.facts)||current.some(f=>f.evidence.sourcePostId!==post.id||!revision.facts.some(old=>isDeepStrictEqual(old,f))))throw new ProcessingError('FACT_EVIDENCE_CHANGED');
 return current;
}
