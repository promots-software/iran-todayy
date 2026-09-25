import {protectReceipt,preserveReceipt,type ReceiptProtection,type ReviewContext} from './receipt-preservation';
import {ProcessingError} from './contracts';
export type ReceiptCorrection={layer:'REVIEW';code:string;issues:unknown;previousOutput:unknown;instructions:string;protectedFindings?:ReceiptProtection};
/** One bounded receipt correction; immutable article/source stay with the caller.
 * It never spends article R1/R2 or retries transport ambiguity. */
export async function recoverReview<T>(run:(correction?:ReceiptCorrection)=>Promise<unknown>,validate:(raw:unknown)=>T,onFailure:(initial:ProcessingError,remaining:ProcessingError|null)=>void,consume:()=>boolean,context?:ReviewContext){
 const immutableContext=context?structuredClone(context):undefined;
 let protection:ReceiptProtection|undefined;
 let initial:ProcessingError|undefined,correction:ReceiptCorrection|undefined;
 for(let attempt=0;attempt<2;attempt++){
  let raw:unknown;
  try{raw=await run(correction);const value=validate(raw);if(protection&&immutableContext)preserveReceipt(protection,raw,immutableContext,value);if(initial)onFailure(initial,null);return value;}
  catch(error){
   if(!(error instanceof ProcessingError))throw error;
   if(initial){onFailure(initial,error);throw new ProcessingError(error.code,error.retryable,{stage:'publication_review',issues:error.diagnostic&&'issues'in error.diagnostic?error.diagnostic.issues:[],initialFailure:{code:initial.code,issues:initial.diagnostic&&'issues'in initial.diagnostic?initial.diagnostic.issues:[]},repairFailure:{code:error.code,issues:error.diagnostic&&'issues'in error.diagnostic?error.diagnostic.issues:[]}},error.retryAfterMs);}
   if(!['REVIEW_RECEIPT_INVALID','AI_INVALID_SCHEMA','DIRECT_PUBLICATION_REVIEW_FAILED'].includes(error.code)||!consume())throw error;
   protection=immutableContext?protectReceipt(raw??(error.diagnostic&&'output'in error.diagnostic?error.diagnostic.output:null),immutableContext):undefined;
   initial=error;correction={layer:'REVIEW',...(protection?{protectedFindings:structuredClone(protection)}:{}),code:error.code,issues:error.diagnostic&&'issues'in error.diagnostic?error.diagnostic.issues:[],previousOutput:raw??(error.diagnostic&&'output'in error.diagnostic?error.diagnostic.output:null),instructions:'Correct ONLY the independent review receipt. Re-evaluate against the unchanged complete original source and unchanged article. Do not rewrite the article, invent evidence or assume it is valid. Return a complete coherent review. Preserve genuine unsupported additions and material omissions as rejections. Semantic states describe event meaning, not verb morphology. Protected findings are immutable lower bounds: SUPPORTED may become UNCERTAIN or UNSUPPORTED; UNCERTAIN may become UNSUPPORTED; never relax UNSUPPORTED or promote UNCERTAIN to SUPPORTED. Preserve every protected exact candidate span and source linkage even if IDs or component boundaries change. Account for missing text without assuming it is non-material or unsupported. Correct incoherent temporal accounting separately; never erase an unrelated protected negative. Expanded accounting does not authorize broader article repair.'};
  }
 }
 throw new ProcessingError('REVIEW_RECEIPT_INVALID');
}
