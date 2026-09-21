/** Invalid configuration aborts startup instead of silently lifting a guard. */
export function costConfig(env:Record<string,string|undefined>=process.env){
 const read=(name:string,fallback:number)=>{const n=env[name]===undefined?fallback:Number(env[name]);if(!Number.isFinite(n)||n<0||env[name]?.trim()==='')throw Error(`INVALID_${name}`);return n;};
 const hard=read('GEMINI_COST_HARD_LIMIT_USD_24H',2),warning=read('GEMINI_COST_WARNING_USD_24H',1.5),retries=read('GEMINI_MAX_TRANSIENT_RETRIES',2);
 if(hard<=0||warning>hard||!Number.isInteger(retries)||retries>2)throw Error('INVALID_GEMINI_COST_POLICY');
 return {hard,warning,retries};
}
export const geminiCostPolicy=costConfig();
export function transientBackoff(attempt:number,providerWait=0,random=Math.random){
 const base=Math.min(120000,30000*2**Math.min(2,Math.max(0,attempt-1)));
 return Math.max(providerWait,Math.round(base*(.8+.4*random())));
}
