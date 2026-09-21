import {PrismaClient} from '@prisma/client';
import {guardedTransport,providerCapacitySnapshot,limits} from '../../../src/worker/provider-guard';
import {geminiCostPolicy} from '../../../src/worker/cost-config';
import {googleQuota} from '../../../src/worker/provider-quota';
import type {Adapter} from './runner';
/** Called ONLY after CLI opt-in. No dotenv, production URLs or project credentials. */
export function validateLiveEnvironment(env:Record<string,string|undefined>,maxCalls:number,maxCost:number){
 if(env.NODE_ENV==='production'||env.VERCEL||env.RAILWAY_ENVIRONMENT_ID||env.DATABASE_URL||env.DATABASE_URL_UNPOOLED||env.GEMINI_API_KEY||env.TELEGRAM_SESSION||env.TELEGRAM_BOT_TOKEN)throw Error('BENCHMARK_PRODUCTION_ENV_REFUSED');
 if(env.BENCHMARK_ISOLATED_PROJECT!=='CONFIRMED'||!env.BENCHMARK_GEMINI_KEY)throw Error('BENCHMARK_ISOLATED_KEY_REQUIRED');
 const url=new URL(env.BENCHMARK_DATABASE_URL??'invalid:');
 if(!['postgresql:','postgres:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/iran_today_benchmark_[a-z0-9_]+$/.test(url.pathname))throw Error('BENCHMARK_LOCAL_DATABASE_REQUIRED');
 if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>500||!Number.isFinite(maxCost)||maxCost<=0||maxCost>2)throw Error('BENCHMARK_BUDGET_REQUIRED');
 if(geminiCostPolicy.hard!==2||geminiCostPolicy.warning!==1.5||googleQuota.rpd!==150000||googleQuota.rpm!==4000||googleQuota.inputTpm!==4000000)throw Error('BENCHMARK_GUARD_CONFIGURATION_CHANGED');
 return url.toString();
}
export function liveAdapter(env:Record<string,string|undefined>,maxCalls:number,maxCost:number):{adapter:Adapter;close:()=>Promise<void>}{
 const datasourceUrl=validateLiveEnvironment(env,maxCalls,maxCost);
 const db=new PrismaClient({datasourceUrl});
 const counts=new Map<string,number>();
 const network=(id:string):typeof fetch=>async(url,init)=>{
  if(String(url)!=='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent')throw Error('BENCHMARK_ENDPOINT_REFUSED');
  // The existing guard has atomically reserved this request before this boundary.
  // These additional caps count the durable local ledger, including prior runs.
  const capacity=await providerCapacitySnapshot(db);
  const count=await db.auditLog.count({where:{entityType:'ProviderBudget',entityId:'gemini',action:'PROVIDER_RESERVED'}});
  if(count>maxCalls||capacity.cost.accountedUsd>maxCost||capacity.cost.accountedUsd>limits.dayReservedUsd)throw Error('BENCHMARK_RUN_CAP');
  counts.set(id,(counts.get(id)??0)+1);return fetch(url,init);
 };
 return {adapter:{mode:'live',key:env.BENCHMARK_GEMINI_KEY!,networkCount:c=>counts.get(c.id)??0,transport:c=>guardedTransport(db,'gold-v1:'+c.id,network(c.id))},close:()=>db.$disconnect()};
}
