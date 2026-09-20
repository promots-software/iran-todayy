/** No provider payload, free-text message, project identifier or credential is
 * retained. Only numeric quota/retry data and allow-listed classifications. */
export function capacityDiagnostic(status:number, payload:unknown, retryHeaderMs=0) {
 const error=(payload as {error?:{status?:string;details?:unknown[]}}|null)?.error;
 const details=Array.isArray(error?.details)?error.details:[];
 const quotas:{period:'MINUTE'|'DAY'|'UNKNOWN';unit:'TOKENS'|'REQUESTS'|'UNKNOWN';limit:number|null}[]=[];
 let retryMs=retryHeaderMs;
 for(const value of details.slice(0,20)) {
  if(!value||typeof value!=='object')continue;
  const d=value as Record<string,unknown>;
  if(d['@type']==='type.googleapis.com/google.rpc.RetryInfo'&&typeof d.retryDelay==='string'&&/^\d+(?:\.\d+)?s$/.test(d.retryDelay))retryMs=Math.max(retryMs,Number(d.retryDelay.slice(0,-1))*1000);
  if(d['@type']==='type.googleapis.com/google.rpc.QuotaFailure'&&Array.isArray(d.violations))for(const v of d.violations.slice(0,20)){
   if(!v||typeof v!=='object')continue;
   const q=v as {quotaId?:unknown;quotaMetric?:unknown;quotaValue?:unknown};
   const descriptor=[q.quotaId,q.quotaMetric].filter(x=>typeof x==='string').join(' ').toLowerCase();
   const limit=typeof q.quotaValue==='number'||typeof q.quotaValue==='string'?Number(q.quotaValue):NaN;
   quotas.push({period:/day/.test(descriptor)?'DAY':/minute/.test(descriptor)?'MINUTE':'UNKNOWN',unit:/token/.test(descriptor)?'TOKENS':/request/.test(descriptor)?'REQUESTS':'UNKNOWN',limit:Number.isFinite(limit)&&limit>=0?limit:null});
  }
 }
 return {httpStatus:status,status:['RESOURCE_EXHAUSTED','UNAVAILABLE','INTERNAL','DEADLINE_EXCEEDED','PERMISSION_DENIED','INVALID_ARGUMENT'].includes(error?.status??'')?error!.status!:'UNKNOWN',quotas,retryMs:Math.min(86400000,Math.max(0,Number.isFinite(retryMs)?retryMs:0))};
}
export type CapacityRow={action:string;createdAt:Date;metadata:unknown};
/** Resource-specific state, independent of job admission. Legacy global
 * cooldowns deliberately cannot block local work or a new capacity controller. */
export function capacityState(rows:CapacityRow[],resource:string,now:number){
 const relevant=rows.filter(r=>(r.metadata as {resource?:string})?.resource===resource).sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime());
 const last=relevant.filter(r=>r.action==='PROVIDER_CAPACITY_BLOCKED').at(-1);
 if(!last)return {waitMs:0,probe:false};
 if(relevant.some(r=>r.action==='PROVIDER_CAPACITY_HEALTHY'&&Number((r.metadata as {requestStartedAt?:number}).requestStartedAt)>=last.createdAt.getTime()))return {waitMs:0,probe:false};
 const until=Number((last.metadata as {until:number}).until);
 if(until>now)return {waitMs:until-now,probe:false};
 const active=relevant.filter(r=>r.action==='PROVIDER_CAPACITY_PROBE'&&r.createdAt>=last.createdAt).at(-1);
 const probeUntil=Number((active?.metadata as {until?:number}|undefined)?.until??0);
 return {waitMs:Math.max(0,probeUntil-now),probe:probeUntil<=now};
}
export function capacityRetryMs(diagnostic:ReturnType<typeof capacityDiagnostic>){
 // Unknown quota capacity gets one recovery probe, not one request per queued
 // story and not exponential project-wide freezes. Honor explicit server waits.
 return Math.max(1000,diagnostic.retryMs||60000);
}
