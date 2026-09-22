import {ProcessingError} from './contracts';
const repairable=new Set(['AMBIGUOUS_EVIDENCE_CONTEXT','EVIDENCE_CONTEXT_REQUIRED','INVALID_EVIDENCE','INCOMPLETE_EXTRACTION','SPEAKER_ATTRIBUTION_MISMATCH','SPEAKER_ATTRIBUTION_REQUIRED','DIRECT_MATERIAL_COVERAGE_FAILED','DIRECT_PUBLICATION_UNSUPPORTED','DIRECT_PUBLICATION_NUMBER_MISMATCH','DIRECT_PUBLICATION_DATE_MISMATCH','DIRECT_PUBLICATION_QUOTE_MISMATCH','DIRECT_PUBLICATION_ENTITY_ATTRIBUTION_MISMATCH','DIRECT_PUBLICATION_REVIEW_FAILED','DIRECT_UNINFORMATIVE_TITLE','UNVALIDATED_ARABIC_RENDERING','ARABIC_RENDERING_NUMBER_MISMATCH','ARABIC_RENDERING_ENTITY_UNSUPPORTED','ARABIC_RENDERING_QUOTE_ADDED','MATERIAL_DATE_MISMATCH']);
/** At most one repair, same evidence and validators. Never retries transport or a repair. */
export async function withOneRepair<T>(initial:()=>Promise<T>,repair:(code:string)=>Promise<T>):Promise<T>{
 try{return await initial();}catch(error){
  if(!(error instanceof ProcessingError)||!repairable.has(error.code))throw error;
  try{return await repair(error.code);}catch(remaining){
   if(remaining instanceof ProcessingError&&['AMBIGUOUS_EVIDENCE_CONTEXT','EVIDENCE_CONTEXT_REQUIRED'].includes(remaining.code))throw new ProcessingError('MATERIAL_EVIDENCE_UNRESOLVED',false,remaining.diagnostic);
   throw remaining;
  }
 }
}
export const repairInstructions='One bounded repair attempt. Re-read the ORIGINAL source in full. Correct only the reported evidence/factual-integrity failure. Do not invent an identity, fact, number, date or speaker. Preserve negation, conditions, uncertainty and every material assertion, including final sentences. For context errors use exact unique source spans, retaining speaker attribution. Prefer conservative source wording over paraphrase. Do not reconsider relevance or selection. All output will pass the same factual validators again; unresolved defects fail closed.';
