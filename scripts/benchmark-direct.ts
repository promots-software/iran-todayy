import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {validateDataset} from '../tests/benchmarks/direct-gold/schema';
import {runCases} from '../tests/benchmarks/direct-gold/runner';
async function main(){
 const args=process.argv.slice(2),allowed=['--live','--confirm-paid','--max-calls','--max-cost'];
 for(let i=0;i<args.length;i++){if(!allowed.includes(args[i]))throw Error('BENCHMARK_UNKNOWN_ARGUMENT');if(['--max-calls','--max-cost'].includes(args[i]))i++;}
 const live=args.includes('--live');if(live!==args.includes('--confirm-paid'))throw Error('BENCHMARK_EXPLICIT_PAID_CONFIRMATION_REQUIRED');
 // Process-local safeguards only; nothing writes deployment environment settings.
 process.env.SHADOW_MODE='true';process.env.REQUIRE_APPROVAL='true';process.env.AUTO_PUBLISH='false';process.env.TELEGRAM_PUBLISH_ENABLED='false';
 const data=validateDataset(JSON.parse(readFileSync(resolve('tests/benchmarks/direct-gold-v1.json'),'utf8')));
 let close=async()=>{};let adapter;
 if(live){
  const calls=Number(args[args.indexOf('--max-calls')+1]),cost=Number(args[args.indexOf('--max-cost')+1]);
  if(!args.includes('--max-calls')||!args.includes('--max-cost'))throw Error('BENCHMARK_BUDGET_REQUIRED');
  const liveModule=await import('../tests/benchmarks/direct-gold/live');const session=liveModule.liveAdapter(process.env,calls,cost);adapter=session.adapter;close=session.close;
  console.log(JSON.stringify({mode:'live',estimatedBaselineCalls:54,comparisonAndReviewCalls:'additional, subject to explicit caps; 54 assumes all baseline stages succeed and one exact duplicate skips extraction',maximumRequests:calls,maximumAccountedUsd:cost,warningUsd:1.5,hardUsd:2}));
 }
 try{
  const report=await runCases(data.cases,adapter);
  const path=resolve('.test-tools/benchmarks/direct-gold-v1-'+(live?'live':'replay')+'.json');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(report,null,2)+'\n');
  const {results,...summary}=report;console.log(JSON.stringify({...summary,report:path},null,2));
  for(const r of results)console.log(`${r.id} | ${r.observation.disposition} | ${r.findings.map(f=>f.kind+':'+f.code).join(',')||'PASS'} | mock=${r.simulatedRequests} network=${r.networkRequests}`);
  // Qualification failures are visible in exit status; not hidden by passing harness tests.
  if(report.passingCases!==report.caseCount)process.exitCode=1;
 }finally{await close();}
}
main().catch(e=>{console.error(e instanceof Error&&/^BENCHMARK_[A-Z_]+$/.test(e.message)?e.message:'BENCHMARK_ABORTED: sensitive details withheld.');process.exitCode=1;});
