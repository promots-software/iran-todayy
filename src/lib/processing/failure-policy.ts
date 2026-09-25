import {ProcessingError} from './contracts';
const transient=/^(?:GEMINI_HTTP_(?:429|5\d\d)|GEMINI_TRANSPORT_FAILED|GROQ_(?:RATE_LIMIT|UNAVAILABLE|TRANSPORT_FAILED|INTERRUPTED)|WORKER_INTERRUPTED|LEASE_EXPIRED)$/;
export const providerWaitCodes=['PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW','PROVIDER_TRANSIENT_WAIT','PROVIDER_RETRY_EXHAUSTED','PROVIDER_BUDGET_EXHAUSTED','PROVIDER_COOLDOWN','PROVIDER_CAPACITY_WAIT','PROVIDER_RPM_WAIT','PROVIDER_TPM_WAIT','PROVIDER_RPD_WAIT','PROVIDER_COST_WAIT','PROVIDER_HOURLY_WAIT','GEMINI_HTTP_429'];
export function requiresProviderRecovery(code:string){return code==='PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW'||code==='PROVIDER_RETRY_EXHAUSTED';}
export function isProviderWait(code:string){return providerWaitCodes.includes(code);}
const budget=/^(?:APPLICATION_CONTINUATION_BUDGET|PROVIDER_REQUEST_LIMIT|GROQ_REQUEST_LIMIT|PROVIDER_BUDGET_EXHAUSTED|PROVIDER_COOLDOWN|PROVIDER_(?:CAPACITY|RPM|TPM|RPD|COST|HOURLY|TRANSIENT)_WAIT|PROVIDER_RETRY_EXHAUSTED|MATCH_SNAPSHOT_CHANGED|SOURCE_PROCESSING_MODE_CHANGED|STALE_CLAIM)$/;
export function failurePolicy(code:string,attempt:number,retryAfterMs=0){
 const ambiguous=/^(?:GEMINI_TRANSPORT_FAILED|GROQ_TRANSPORT_FAILED|GROQ_INTERRUPTED|WORKER_INTERRUPTED|LEASE_EXPIRED)$/.test(code);
 const retryable=!ambiguous&&!requiresProviderRecovery(code)&&(transient.test(code)||budget.test(code));
 const providerFailure=/^(?:GEMINI_HTTP_(?:429|5\d\d)|GEMINI_TRANSPORT_FAILED|GROQ_(?:RATE_LIMIT|UNAVAILABLE|TRANSPORT_FAILED))$/.test(code);
 return {retryable,providerFailure,
  delayMs:Math.max(Math.min(3600000,30000*2**Math.min(Math.max(0,attempt-1),7)),Math.min(86400000,Math.max(0,retryAfterMs))),
  recovery:retryable?'BOUNDED_RETRY_THEN_MANUAL_RECOVERY':'HUMAN_REVIEW_NO_AUTOMATIC_REPLAY',
  // Ambiguous requests are retained for reconciliation, not blindly repeated.
  safeCheckpointRetry:/^(?:APPLICATION_CONTINUATION_BUDGET|GEMINI_HTTP_(?:429|5\d\d)|GROQ_(?:RATE_LIMIT|UNAVAILABLE)|PROVIDER_(?:REQUEST_LIMIT|RETRY_EXHAUSTED|BUDGET_EXHAUSTED|COOLDOWN|(?:CAPACITY|RPM|TPM|RPD|COST|HOURLY|TRANSIENT)_WAIT)|GROQ_REQUEST_LIMIT)$/.test(code),
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
