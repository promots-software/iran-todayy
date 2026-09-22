import {readEditorialState,isTechnicalFailure} from './processing/editorial-eligibility';
type Publication={status:string};
type Item={status:string;validationResult?:unknown;processingResult?:unknown;error?:string|null;publication?:Publication|null;humanDraft?:{status:string;publications?:Publication[]}|null};
/** Presentation only: never grants eligibility or changes historical evidence.
 * Durable delivery dominates obsolete processing snapshots. */
export function workflowState(item:Item,linked:Item[]=[]){
 const publications=[item.publication,...(item.humanDraft?.publications??[]),...linked.flatMap(n=>[n.publication,...(n.humanDraft?.publications??[])])].filter((p):p is Publication=>!!p);
 if(publications.some(p=>p.status==='SENT')||item.status==='PUBLISHED'||item.humanDraft?.status==='PUBLISHED')return 'PUBLISHED';
 for(const status of ['UNKNOWN','SENDING','FAILED'])if(publications.some(p=>p.status===status))return status==='FAILED'?'DELIVERY_FAILED':status;
 if(publications.some(p=>p.status==='PENDING'))return 'APPROVED';
 if(item.humanDraft?.status==='DRAFT')return 'NEEDS_REVIEW';
 if(item.status==='FAILED')return !item.error||isTechnicalFailure(item.error)?'PROCESSING_ERROR':'NEEDS_REVIEW';
 if(['REJECTED','FILTERED','DUPLICATE','APPROVED','QUEUED'].includes(item.status))return item.status;
 if(item.error&&isTechnicalFailure(item.error))return 'PROCESSING_ERROR';
 if(['INGESTED','NORMALIZED','CLASSIFYING','DEDUPLICATING','DRAFTING','VALIDATING'].includes(item.status))return item.status;
 return readEditorialState(item.validationResult??item.processingResult,item.status,item.error);
}
