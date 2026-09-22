import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDataset,type GoldCase} from './benchmarks/direct-gold/schema';
import {evaluate,type Observation} from './benchmarks/direct-gold/evaluate';
import {runCases} from './benchmarks/direct-gold/runner';
import {replayTransport} from './benchmarks/direct-gold/replay';
import {validateLiveEnvironment} from './benchmarks/direct-gold/live';
import {memorySimulation} from './benchmarks/direct-gold/simulation';
import {checkpointCall} from '../src/worker/checkpoints';
const dataset=validateDataset(JSON.parse(readFileSync('tests/benchmarks/direct-gold-v1.json','utf8')));
const get=(id:string)=>dataset.cases.find(c=>c.id===id)!;
function reference(c:GoldCase):Observation{
 const title='إيران الآن | '+c.materialFacts[0].meaning;
 const body=c.materialFacts.length>1?c.materialFacts.map(f=>f.meaning).join('\n'):'';
 return {title,body,sentences:[{text:title,factIds:['f1']},...(body?c.materialFacts.map(f=>({text:f.meaning,factIds:[f.id]})):[])],facts:c.materialFacts.map(f=>({id:f.id,excerpt:f.sourceExcerpt})),disposition:c.expectedDisposition,relation:c.relation.kind,delivery:'HOLD',review:[]};
}
function replace(o:Observation,from:string,to:string){o.title=o.title.replaceAll(from,to);o.body=o.body.replaceAll(from,to);o.sentences=o.sentences.map(s=>({...s,text:s.text.replaceAll(from,to)}));return o;}
test('exactly 50 stratified cases with explicit provenance, semantic predicates and no fictional historical pairing',()=>{
 assert.deepEqual(Object.fromEntries('ABCDEFGHIJ'.split('').map(k=>[k,dataset.cases.filter(c=>c.category===k).length])),{A:8,B:8,C:6,D:5,E:4,F:5,G:5,H:3,I:3,J:3});
 assert.equal(dataset.trueHistoricalSourceGoldPairs,0);assert(dataset.cases.every(c=>c.sourceType==='SYNTHETIC'));
 assert.throws(()=>validateDataset({...dataset,cases:dataset.cases.slice(1)}),/GOLD_CASE_COUNT/);
 assert.throws(()=>validateDataset({...dataset,cases:[dataset.cases[0],...dataset.cases.slice(0,49)]}),/GOLD_ID_OR_RELATION/);
});
test('all 50 independently authored reference observations satisfy finite gold checks',()=>{
 for(const c of dataset.cases)assert.deepEqual(evaluate(c,reference(c)),[],c.id);
});
for(const [name,id,from,to,code] of [
 ['number','D23','12','13','NUMBER_CHANGED'],['date','D23','5 أكتوبر','6 أكتوبر','DATE_CHANGED'],['location','D23','طهران','بغداد','LOCATION_CHANGED'],['speaker','D17','الوزارة','الشركة','ATTRIBUTION_CHANGED'],
 ['negation','D18','لم تنته','انتهت','MODALITY_OR_NEGATION_CHANGED'],['certainty','D48','قد تبدأ','بدأت','MODALITY_OR_NEGATION_CHANGED'],['quote','D28','لن تتوقف','ستتوقف','QUOTE_CHANGED'],
 ['entity','D01','لتقديم الطلبات','لتقديم الطلبات بالتعاون مع شركة الأطلس','FORBIDDEN_ADDITION'],['cause','D49','تأخرت الأعمال بسبب الأمطار','هطلت الأمطار بسبب تأخر الأعمال','FACT_MEANING_MISSING_OR_CHANGED'],
 ['purpose','D49','الأمطار','الأمطار لزيادة التمويل','FORBIDDEN_ADDITION'],['pronoun','D45','قواعدنا','القواعد الإيرانية','FORBIDDEN_ADDITION'],['condition','D48','إذا نجحت المراجعة','','CONDITION_CHANGED'],
 ['audience','D46','السكان لم يبلغوا بالموعد','لم يعلن الموعد','FORBIDDEN_ADDITION'],
] as const)test('oracle rejects intentional '+name+' corruption',()=>{
 const c=get(id),o=replace(reference(c),from,to);assert(evaluate(c,o).some(f=>f.kind==='CRITICAL'&&f.code===code));
});
test('omitted final material sentence and truncated multifactual output are detected',()=>{
 for(const id of ['D12','D16','D50']){const c=get(id),o=reference(c),last=c.materialFacts.at(-1)!;o.body=o.body.split('\n').slice(0,-1).join('\n');o.sentences=o.sentences.filter(s=>!s.factIds.includes(last.id));assert(evaluate(c,o).some(f=>f.code==='MATERIAL_OMISSION'));}
});
test('dropping attribution while retaining fact IDs does not pass',()=>{
 const c=get('D17'),o=replace(reference(c),'قالت الوزارة إن ','');assert(evaluate(c,o).some(f=>f.code==='ATTRIBUTION_CHANGED'));
});
test('same words and valid fact IDs cannot swap speakers of conflicting claims',()=>{
 const c=get('D47'),o=reference(c);o.title=o.title.replace('قال المجلس إن الشركة','قالت الشركة إن المجلس');o.sentences[0].text=o.title;
 assert(evaluate(c,o).some(f=>f.code==='ATTRIBUTION_CHANGED'));
});
test('duplicate/new/update errors are individually rejected',()=>{
 for(const id of ['D42','D43','D44']){const c=get(id),o=reference(c);o.relation=id==='D44'?'DUPLICATE':'NEW_EVENT';assert(evaluate(c,o).some(f=>f.code==='DUPLICATE_UPDATE_DECISION'));}
});
test('different supported wording/order allowed; no exact preferred rewrite equality',()=>{
 const c=get('D01'),o=replace(reference(c),'أطلقت وزارة الطاقة','وزارة الطاقة دشنت');assert.deepEqual(evaluate(c,o),[]);
});
test('identical vocabulary cannot reverse subject and object roles',()=>{
 const c=get('D01'),o=reference(c);replace(o,'أطلقت وزارة الطاقة خدمة إلكترونية','أطلقت خدمة إلكترونية وزارة الطاقة');assert(evaluate(c,o).some(f=>f.code==='ENTITY_RELATIONSHIP_CHANGED'));
});
test('novel paraphrase is unresolved, never silently approved by token overlap',()=>{
 const c=get('D01'),o=replace(reference(c),'أطلقت','ابتكرت');assert(evaluate(c,o).some(f=>f.kind==='UNVERIFIED'));assert(evaluate(c,o).some(f=>f.code==='FACT_MEANING_MISSING_OR_CHANGED'));
});
test('invalid references, altered evidence and provenance changes fail separately',()=>{
 const c=get('D01'),o=reference(c);o.sentences[0].factIds=['unknown'];o.facts[0].excerpt='fabricated';o.sentences[0].text+=' unseen';const f=evaluate(c,o);for(const code of ['INVALID_EVIDENCE_ID','EVIDENCE_CHANGED','PROVENANCE_TEXT_MISMATCH'])assert(f.some(x=>x.code===code));
});
test('unsafe delivery is never accepted even for otherwise valid ready text',()=>{
 const c=get('D01'),o=reference(c);o.delivery='SEND';assert(evaluate(c,o).some(f=>f.code==='UNSAFE_DELIVERY'));
});
test('all 50 run through actual pure DIRECT validators with network globally prohibited',async()=>{
 process.env.SHADOW_MODE='true';process.env.REQUIRE_APPROVAL='true';
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('UNEXPECTED_NETWORK');};
 try{
  const report=await runCases(dataset.cases);assert.equal(report.networkRequests,0);assert.equal(report.caseCount,50);assert.equal(report.estimatedCostUsd,0);assert.equal(report.qualification,'NOT_LAUNCH_QUALIFIED');
  assert(report.results.every(r=>r.observation.delivery==='HOLD'));assert(!report.results.flatMap(r=>r.usage).some(u=>u.stage.includes('classify')));
  assert.equal(report.results.find(r=>r.id==='D42')!.simulatedRequests,0);
  // Two extraction/translation calls plus final article generation under the full contract.
  for(const id of ['D37','D38','D39','D40','D41'])assert.equal(report.results.find(r=>r.id===id)!.simulatedRequests,3);
  assert.equal(report.results.find(r=>r.id==='D45')!.observation.disposition,'READY_TO_PUBLISH');
  // Findings are deliberately not converted into a passing launch gate.
  const update=report.results.find(r=>r.id==='D44')!;assert.equal(update.findings.some(f=>f.code==='DUPLICATE_UPDATE_DECISION'),update.observation.relation!=='MATERIAL_UPDATE');
 }finally{globalThis.fetch=old;}
});
test('invalid provider fixture fails closed through real DIRECT validation, no live fallback',async()=>{
 process.env.SHADOW_MODE='true';process.env.REQUIRE_APPROVAL='true';
 const report=await runCases([get('D23')],{mode:'replay',key:'offline',transport:c=>async(url,init)=>{const r=await replayTransport(c)(url,init),e=await r.json();const raw=JSON.parse(e.candidates[0].content.parts[0].text);raw.publication.title.text=raw.publication.title.text.replace('12','99');e.candidates[0].content.parts[0].text=JSON.stringify(raw);return Response.json(e);}});
 assert.equal(report.networkRequests,0);assert.notEqual(report.results[0].observation.disposition,'READY_TO_PUBLISH');assert.equal(report.results[0].observation.error,'DIRECT_PUBLICATION_NUMBER_MISMATCH');
});
test('live mode rejects production environment, remote DB, absent key and uncapped spend offline',()=>{
 const env={BENCHMARK_ISOLATED_PROJECT:'CONFIRMED',BENCHMARK_GEMINI_KEY:'offline-placeholder',BENCHMARK_DATABASE_URL:'postgresql://test:test@127.0.0.1/iran_today_benchmark_gold'};
 assert.match(validateLiveEnvironment(env,60,1),/127.0.0.1/);
 for(const extra of [{NODE_ENV:'production'},{DATABASE_URL:'redacted'},{RAILWAY_ENVIRONMENT_ID:'test'},{GEMINI_API_KEY:'redacted'},{TELEGRAM_SESSION:'redacted'},{BENCHMARK_DATABASE_URL:'postgresql://test:test@production.invalid/main'},{BENCHMARK_GEMINI_KEY:''}])assert.throws(()=>validateLiveEnvironment({...env,...extra},60,1));
 assert.throws(()=>validateLiveEnvironment(env,0,1));assert.throws(()=>validateLiveEnvironment(env,60,3));
});
test('future simulation ports preserve idempotent persistence, ordering and completed checkpoint across recovery',async()=>{
 const ports=memorySimulation();assert.equal(await ports.persist('p1',{source:'synthetic'}),true);assert.equal(await ports.persist('p1',{}),false);await ports.schedule('p1',100);ports.advance(100);assert.equal(ports.pending.get('p1'),ports.now());
 let calls=0;const first=await checkpointCall(ports.checkpoint,'stage',async()=>{calls++;return {valid:true};});const resumed=await checkpointCall(ports.checkpoint,'stage',async()=>{calls++;return {};});assert.deepEqual(first,resumed);assert.equal(calls,1);
 await ports.checkpoint.start('ambiguous');await assert.rejects(checkpointCall(ports.checkpoint,'ambiguous',async()=>{calls++;}),/REQUIRES_REVIEW/);assert.equal(calls,1);
});
