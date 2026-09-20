export const googleQuota={rpm:15,inputTpm:250000,rpd:500} as const;
const pacificDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
/** Calendar boundaries, including 23/25-hour DST days. Never substitute a
 * rolling 24-hour window for Google's Pacific calendar-day quota. */
export function pacificDay(now:number){
 const label=pacificDate.format(new Date(now));
 let lo=now-27*3600000,hi=now;
 while(hi-lo>1){const m=Math.floor((lo+hi)/2);if(pacificDate.format(new Date(m))===label)hi=m;else lo=m;}
 const start=hi;lo=now;hi=now+27*3600000;
 while(hi-lo>1){const m=Math.floor((lo+hi)/2);if(pacificDate.format(new Date(m))===label)lo=m;else hi=m;}
 return {label,start,end:hi};
}
export type QuotaReservation={at:number;inputTokens:number};
export function quotaDecision(rows:QuotaReservation[],inputTokens:number,now:number){
 const day=pacificDay(now),minute=rows.filter(r=>r.at>now-60000&&r.at<=now),today=rows.filter(r=>r.at>=day.start&&r.at<=now);
 const usage={rpm:minute.length,inputTpm:minute.reduce((s,r)=>s+r.inputTokens,0),rpd:today.length,resetAt:day.end};
 if(!Number.isSafeInteger(inputTokens)||inputTokens<0||inputTokens>googleQuota.inputTpm||rows.some(r=>!Number.isSafeInteger(r.inputTokens)||r.inputTokens<0))return {...usage,reason:'PROVIDER_INPUT_LIMIT',waitMs:0};
 if(today.length>=googleQuota.rpd)return {...usage,reason:'PROVIDER_RPD_WAIT',waitMs:day.end-now};
 if(minute.length>=googleQuota.rpm||usage.inputTpm+inputTokens>googleQuota.inputTpm){
  const boundaries=[...new Set(minute.map(r=>r.at+60000))].sort((a,b)=>a-b);
  const next=boundaries.find(t=>{const active=minute.filter(r=>r.at>t-60000);return active.length<googleQuota.rpm&&active.reduce((s,r)=>s+r.inputTokens,0)+inputTokens<=googleQuota.inputTpm;});
  return {...usage,reason:minute.length>=googleQuota.rpm?'PROVIDER_RPM_WAIT':'PROVIDER_TPM_WAIT',waitMs:Math.max(1,(next??now+60000)-now)};
 }
 return {...usage,reason:null,waitMs:0};
}
