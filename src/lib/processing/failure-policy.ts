import {ProcessingError} from './contracts';
const transient=/^(?:GEMINI_HTTP_(?:429|5\d\d)|GEMINI_TRANSPORT_FAILED|GROQ_(?:RATE_LIMIT|UNAVAILABLE|TRANSPORT_FAILED|INTERRUPTED)|WORKER_INTERRUPTED|LEASE_EXPIRED)$/;
const budget=/^(?:PROVIDER_REQUEST_LIMIT|GROQ_REQUEST_LIMIT|PROVIDER_BUDGET_EXHAUSTED|PROVIDER_COOLDOWN)$/;
export function failurePolicy(code:string,attempt:number,retryAfterMs=0){
 const retryable=transient.test(code)||budget.test(code);
 const providerFailure=/^(?:GEMINI_HTTP_(?:429|5\d\d)|GEMINI_TRANSPORT_FAILED|GROQ_(?:RATE_LIMIT|UNAVAILABLE|TRANSPORT_FAILED))$/.test(code);
 return {retryable,providerFailure,
  delayMs:Math.max(Math.min(3600000,30000*2**Math.min(Math.max(0,attempt-1),7)),Math.min(86400000,Math.max(0,retryAfterMs))),
  recovery:retryable?'BOUNDED_RETRY_THEN_MANUAL_RECOVERY':'HUMAN_REVIEW_NO_AUTOMATIC_REPLAY',
  // Ambiguous requests are retained for reconciliation, not blindly repeated.
  safeCheckpointRetry:/^(?:GEMINI_HTTP_(?:429|5\d\d)|GROQ_(?:RATE_LIMIT|UNAVAILABLE)|PROVIDER_(?:REQUEST_LIMIT|BUDGET_EXHAUSTED|COOLDOWN)|GROQ_REQUEST_LIMIT)$/.test(code),
 };
}
export function retryAfter(headers:Headers,now=Date.now()){
 const value=headers.get('retry-after');if(!value)return 0;
 const ms=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-now;
 return Number.isFinite(ms)?Math.min(86400000,Math.max(0,ms)):0;
}
export function processingFailure(error:unknown,aborted:boolean){
 const code=error instanceof ProcessingError?error.code:aborted?'WORKER_INTERRUPTED':'PROCESSING_FAILED';
 return {code,...failurePolicy(code,1,error instanceof ProcessingError?error.retryAfterMs:0)};
}
