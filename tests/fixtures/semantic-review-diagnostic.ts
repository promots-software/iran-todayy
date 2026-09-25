import {validatePublicationReviewProtocol} from '../../src/lib/processing/direct-publication';
import {validateFidelityReceipt,type PublicationUnit} from '../../src/lib/processing/fidelity-ledger';
import {ProcessingError} from '../../src/lib/processing/contracts';
export type SemanticVerdict='SUPPORTED'|'UNSUPPORTED'|'UNCERTAIN';
/** Evaluation only. Expected truth is supplied by an adjudicated fixture, never
 * inferred from words or from whether the receipt happens to be well formed. */
export function scoreSavedReview(source:string,publication:PublicationUnit[],raw:unknown,semanticExpected:SemanticVerdict){
 let semanticObserved:SemanticVerdict|'UNSCORABLE'='UNSCORABLE';
 try{
  const v=validatePublicationReviewProtocol(raw,publication.length-1);
  const claims=v.fidelityLedger?.claims??[],coverage=v.fidelityLedger?.sourceCoverage??[];
  if(claims.length&&coverage.length){
   const verdicts=[...claims.flatMap(c=>[c.verdict,...c.components.map(p=>p.verdict)]),...v.review.map(r=>r.verdict)];
   semanticObserved=verdicts.includes('UNSUPPORTED')||coverage.some(r=>r.disposition==='MISSING'||r.temporal.some(t=>t.assessment==='CHANGED'))?'UNSUPPORTED':verdicts.includes('UNCERTAIN')||coverage.some(r=>r.disposition==='UNCERTAIN'||r.temporal.some(t=>t.assessment==='UNCERTAIN'))?'UNCERTAIN':'SUPPORTED';
  }
 }catch{/* Malformed structure cannot supply a complete observed semantic decision. */}
 let receiptValid=true,receiptFailureReason:string|null=null,receiptFailurePath:unknown=null;
 try{const v=validatePublicationReviewProtocol(raw,publication.length-1);validateFidelityReceipt(source,publication,v.fidelityLedger);}
 catch(e){receiptValid=false;if(e instanceof ProcessingError){const issue=e.diagnostic&&'issues'in e.diagnostic?e.diagnostic.issues?.[0]:undefined;receiptFailureReason=issue?.code??e.code;receiptFailurePath=issue?.path??null;}else throw e;}
 return {semanticExpected,semanticObserved,semanticCorrect:semanticObserved==='UNSCORABLE'?null:semanticObserved===semanticExpected,receiptValid,receiptFailureReason,receiptFailurePath};
}
