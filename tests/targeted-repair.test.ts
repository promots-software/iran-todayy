import {supportedLedger} from './fixtures/fidelity-review';
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalStage,type StageRepair} from '../src/lib/processing/normal-v2';
import {ProcessingError} from '../src/lib/processing/contracts';
import {MAX_TARGETED_REPAIRS,normalizeGeneratedArabic,scopePreserved,secondRepairDecision,type RepairDiagnostic} from '../src/lib/processing/targeted-repair';
import {mergeDiagnosedRepair} from '../src/lib/processing/repair-integrity';
const source='أعلنت الوزارة افتتاح 8 مدارس.';
const d=(value:string,code='DIRECT_PUBLICATION_NUMBER_MISMATCH',path:(string|number)[]=['publication','title','text']):RepairDiagnostic=>({code,path,current:value,expected:'Exact source quantity 8',cause:'Unsupported generated quantity',sourceSpans:[{start:0,end:source.length,text:source}],factIds:['f1'],speakerIds:['f1:speaker'],occurrenceIds:['0:'+source.length],allowedPaths:[path]});
const candidate=(text:string)=>({publication:{title:{text,factIds:['f1']},body:[{text:'فقرة ثابتة',factIds:['f1']}]}});
function failure(text:string,ds:RepairDiagnostic[]){return new ProcessingError('DIRECT_PUBLICATION_NUMBER_MISMATCH',false,{stage:'draft',issues:ds.map(x=>({code:x.code,path:x.path})),output:candidate(text),repairDiagnostics:ds});}
async function sequence(values:(string|ProcessingError)[]){let calls=0;const repairs:StageRepair[]=[];const telemetry:unknown[]=[];const promise=normalStage('draft',async repair=>{if(repair)repairs.push(repair);const value=values[calls++];if(value instanceof ProcessingError)throw value;return value;},source,e=>telemetry.push(e));return {promise,calls:()=>calls,repairs,telemetry};}
test('valid V0: zero repair requests',async()=>{const s=await sequence(['valid']);assert.equal(await s.promise,'valid');assert.equal(s.calls(),1);assert.equal(s.repairs.length,0);});
test('R1 resolves everything: one repair',async()=>{const s=await sequence([failure('9',[d('9')]),'valid']);assert.equal(await s.promise,'valid');assert.equal(s.repairs.length,1);});
test('R2 uses V1 candidate and diagnostics, never V0',async()=>{const s=await sequence([failure('9',[d('9')]),failure('10',[d('10','DIRECT_PUBLICATION_DATE_MISMATCH')]),'valid']);assert.equal(await s.promise,'valid');assert.equal(s.repairs.length,2);assert.deepEqual(s.repairs[1].previousOutput,candidate('10'));assert.equal(s.repairs[1].diagnostics![0].code,'DIRECT_PUBLICATION_DATE_MISMATCH');});
test('multiple current defects in one region use one R2 cycle',async()=>{const ds=[d('10'),d('10','DIRECT_PUBLICATION_QUOTE_MISMATCH'),d('10','UNSUPPORTED_CAUSALITY')];const s=await sequence([failure('9',[d('9')]),failure('10',ds),'valid']);await s.promise;assert.deepEqual(s.repairs[1].diagnostics,ds);assert.equal(s.calls(),3);});
test('multiple explicit regions and unrelated text are fenced',()=>{const before=candidate('9'),after=candidate('8');after.publication.body[0].text='تصحيح';const ds=[d('9'),d('فقرة ثابتة','UNSUPPORTED_ASSERTION',['publication','body',0,'text'])];assert(scopePreserved(before,after,ds));assert(!scopePreserved(before,after,[d('9')]));});
test('same diagnosis cannot spend R2',async()=>{const s=await sequence([failure('9',[d('9')]),failure('9',[d('9')])]);await assert.rejects(s.promise,/AI_SCHEMA_REPAIR_FAILED/);assert.equal(s.calls(),2);});
for(const code of ['AMBIGUOUS_EVIDENCE_CONTEXT','STRUCTURAL_EQUALITY','SOURCE_LANGUAGE_UNCERTAIN','UNRELATED_TO_IRAN','NON_NEWS_PROMO','DUPLICATE','SOURCE_TEXT_REQUIRED'])test(code+' never qualifies for R2',()=>{assert.notEqual(secondRepairDecision([d('9',code)],[],source,candidate('9')),'TARGETED_SECOND_REPAIR');});
test('no source support means no fabricated R2 correction',()=>{const bad=d('9');bad.sourceSpans=[];assert.notEqual(secondRepairDecision([bad],[],source,candidate('9')),'TARGETED_SECOND_REPAIR');});
test('two failed repairs stop; impossible to schedule third',async()=>{const s=await sequence([failure('9',[d('9')]),failure('10',[d('10')]),failure('11',[d('11')]),'FORBIDDEN']);await assert.rejects(s.promise,/AI_SCHEMA_REPAIR_FAILED/);assert.equal(s.calls(),3);assert.equal(s.repairs.length,MAX_TARGETED_REPAIRS);});
test('R2 minimum scope preserves R1 and rejects undiagnosed fields',()=>{const before=candidate('8');before.publication.body[0].text='خطأ';const repair:StageRepair={stage:'draft',code:'x',issues:[],instructions:'',cycle:2,diagnostics:[d('خطأ','UNSUPPORTED_ASSERTION',['publication','body',0,'text'])]};const after=structuredClone(before);after.publication.body[0].text='تصحيح';assert.deepEqual(mergeDiagnosedRepair(before,after,repair),after);after.publication.title.text='9';assert.throws(()=>mergeDiagnosedRepair(before,after,repair),/REPAIR_UNDIAGNOSED_CHANGE/);});
test('R2 cannot reorder facts or change provenance IDs',()=>{const before=candidate('9'),after=candidate('8');after.publication.title.factIds=['f2'];assert(!scopePreserved(before,after,[d('9')]));});
test('safe Arabic glyph normalization preserves source quotations',()=>{assert.equal(normalizeGeneratedArabic('ذكرت فاکس «ی ک»'),'ذكرت فاكس «ی ک»');const source='ی ک';normalizeGeneratedArabic(source);assert.equal(source,'ی ک');});
test('stale V0 diagnostic does not authorize R2',()=>{assert.equal(secondRepairDecision([d('9')],[],source,candidate('8')),'STALE_DIAGNOSIS');});
test('R2 runs complete validation and rejects newly introduced defect',async()=>{let checks=0;const s=await sequence([failure('9',[d('9')]),failure('10',[d('10')]),new ProcessingError('UNSUPPORTED_OUTPUT')]);try{await s.promise;}catch(e){checks++;assert.match(String(e),/UNSUPPORTED_OUTPUT/);}assert.equal(checks,1);assert.equal(s.calls(),3);});
test('transport/cost waits never become a repair request',async()=>{for(const code of ['PROVIDER_COST_WAIT','GEMINI_HTTP_429','GEMINI_HTTP_503']){const s=await sequence([new ProcessingError(code,true)]);await assert.rejects(s.promise,new RegExp(code));assert.equal(s.repairs.length,0);}});

import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {unknownProfile,validateUnderstanding} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {renderingChecks} from '../src/lib/processing/rendering-contract';
for(const repairs of [0,1,2] as const)test(`actual DIRECT request path: ${repairs} targeted repairs with full independent revalidation`,async()=>{
 let generation=0,review=0;
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const request=JSON.parse(String(init?.body)),data=JSON.parse(request.contents[0].parts[0].text);
  let value:unknown;
  if(request.generationConfig.responseJsonSchema.properties.extraction){
   generation++;const n=generation<=repairs?String(8+generation):'8';
   if(generation===3){assert.equal(data.repair.cycle,2);assert.match(data.repair.previousOutput.article.title,/10/);}
   value={extraction:{relevance:'POLITICAL_NEWS',contentType:'NEWS',contentTypeEvidence:{excerpt:source,context:source},actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:source,context:source},speaker:null,kind:'FACT',material:false}],coverage:[{unitId:'u1',nonFactual:false,factIds:['f1']}],safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}},article:{title:'افتتاح '+n+' مدارس',body:source,diagnostics:[]}};
  }else{review++;const ledger=supportedLedger(source,data.publication);if(generation<=repairs){ledger.claims[0].verdict='UNSUPPORTED' as 'SUPPORTED';ledger.claims[0].explanation='Wrong quantity '+(8+generation)+'; source establishes 8.';}value={fidelityLedger:ledger,review:data.publication.map((p:{id:string})=>({id:p.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[],comparisons:[]};}
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
 });
 const u=validateUnderstanding(await provider.understand({processingMode:'DIRECT',content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal),source);
 assert.equal(generation,1+repairs);assert.equal(review,1+repairs);assert.equal(u.directGeneration?.semanticVerification,'INDEPENDENT');
});

import {preparePublication} from '../src/lib/processing/direct-publication';
import {fixture} from './fixtures/processing';
test('actual full draft validation groups number and quote errors across regions',()=>{
 const text='افتتح المجلس مدرسة جديدة تضم 8 صفوف دراسية.';const f=fixture('numbers',text,'ar',text);f.understanding.event.facts[0].id='f1';f.understanding.names=[];f.understanding.event.actors=[];f.understanding.event.action=null;f.understanding.event.object=null;f.understanding.event.location=null;f.understanding.event.summary=null;
 const raw={title:{text:'افتتاح 9 مدارس',factIds:['f1']},body:[{text:text+' «عبارة مختلقة»',factIds:['f1']}]};
 assert.throws(()=>preparePublication(text,f.understanding,raw,[{unitId:'u1',nonFactual:false,factIds:['f1']}]),(e:unknown)=>{assert(e instanceof ProcessingError);assert(e.diagnostic&&'issues'in e.diagnostic,e.code);const codes=e.diagnostic.issues.map(i=>i.code);assert(codes.includes('DIRECT_PUBLICATION_NUMBER_MISMATCH'));assert(codes.includes('DIRECT_PUBLICATION_QUOTE_MISMATCH'));return true;});
});
test('two repairs continue through a mode switch; delivery mode is not an input',async()=>{
 let mode='AUTO',calls=0;
 const result=await normalStage('draft',async repair=>{calls++;if(!repair)throw failure('9',[d('9')]);if(repair.cycle===1){mode='MANUAL';throw failure('10',[d('10')]);}assert.equal(mode,'MANUAL');return 'VALIDATED';},source);
 assert.equal(result,'VALIDATED');assert.equal(mode,'MANUAL');assert.equal(calls,3);
});
test('diagnosed DIRECT sentence scope preserves every unrelated paragraph',()=>{
 const before={article:{body:'صحيح أول. خطأ 9. صحيح أخير.'}};
 const diag=d(before.article.body,'DIRECT_PUBLICATION_NUMBER_MISMATCH',['article','body']);diag.immutableText=['صحيح أول.',' صحيح أخير.'];
 assert(scopePreserved(before,{article:{body:'صحيح أول. تصحيح 8. صحيح أخير.'}},[diag]));
 assert(!scopePreserved(before,{article:{body:'صحيح أول. تصحيح 8. خبر مختلق.'}},[diag]));
});
