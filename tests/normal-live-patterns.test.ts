import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSpeakerEvidence} from '../src/lib/processing/speaker-evidence';
import {validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {validateNormalExtractionCoverage,normalStage} from '../src/lib/processing/normal-v2';
import {directMatchingUnderstanding} from '../src/lib/processing/direct-generation';
import {ProcessingError} from '../src/lib/processing/contracts';
const ev=(source:string,excerpt:string)=>({excerpt,start:source.indexOf(excerpt),end:source.indexOf(excerpt)+excerpt.length});
test('DIRECT literal locative-qualified speaker heading remains source-grounded',()=>{
 const source='تنبيه | المجلس المحلي في العاصمة: افتتاح ثلاث مدارس جديدة';const excerpt='المجلس المحلي في العاصمة: افتتاح ثلاث مدارس جديدة';const e=(excerpt:string)=>({excerpt,context:source});
 const u=directMatchingUnderstanding({actors:[e('المجلس المحلي')],action:e('افتتاح ثلاث مدارس جديدة'),object:null,location:e('العاصمة'),event_time:null,statements:[{evidence:e(excerpt),speaker:e('المجلس المحلي'),kind:'OUTCOME',material:true}],safety:{priority:'P3',filterReason:'NONE',leaderDeath:false,seriousClaim:false,rankUnverified:false,sensitiveActor:false}},source);
 assert.equal(u.event.facts[0].speaker?.evidence.excerpt,'المجلس المحلي');assert.equal(u.event.facts[0].verified,false);assert.equal(u.event.facts[0].evidence.excerpt,excerpt);
});
for(const source of ['المجلس في العاصمة قال الوزير: افتتحت مدرسة.','المجلس في العاصمة و الوزارة: افتتحت مدرسة.','المجلس في العاصمة والوزارة: افتتحت مدرسة.','ذكر الوزير المجلس في العاصمة: افتتحت مدرسة.'])test('attribution semantics are not adjudicated by punctuation regex: '+source,()=>{assert.doesNotThrow(()=>validateSpeakerEvidence(source,ev(source,source),ev(source,'المجلس')));});
test('nonexistent speaker remains blocked with the exact field, one repair only',async()=>{
 const source='أعلنت مؤسسة افتتاح المدرسة.';const raw={relevance:'POLITICAL_NEWS',actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:source,context:source},speaker:{excerpt:'الجهة',context:source}}]};let calls=0;
 await assert.rejects(normalStage('extract',async repair=>{calls++;if(repair)assert.deepEqual(repair.issues,[{code:'INVALID_EVIDENCE',path:['statements','0','speaker']}]);return validateMinimalExtraction(raw,source);}),/AI_SCHEMA_REPAIR_FAILED/);assert.equal(calls,2);
});
for(const source of ['وسم تجريبي — افتتح المجلس مدرسة جديدة.','برچسب آزمایشی — شورا مدرسه جدیدی افتتاح کرد.','Experimental label — The council has opened a new school.'])test('missing semantic coverage mapping is explicit: '+source,()=>{
 const excerpt=source.split('— ')[1];const x=validateMinimalExtraction({relevance:'POLITICAL_NEWS',actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt,context:source},speaker:null}]},source);
 assert.throws(()=>validateNormalExtractionCoverage(source,x),(e:unknown)=>{assert(e instanceof ProcessingError);assert.equal(e.code,'DIRECT_MATERIAL_COVERAGE_FAILED');assert(e.diagnostic&&'issues'in e.diagnostic);assert.deepEqual(e.diagnostic.issues[0].path,['coverage']);return true;});
});
test('uncovered negation, conditions and numbers are never discarded as layout',()=>{
 for(const prefix of ['لم','إذا وافق المجلس','بعد 3 أيام']){const source=prefix+' — افتتح المجلس مدرسة جديدة.';const excerpt='افتتح المجلس مدرسة جديدة.';const x=validateMinimalExtraction({relevance:'POLITICAL_NEWS',actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt,context:source},speaker:null}]},source);assert.throws(()=>validateNormalExtractionCoverage(source,x),/DIRECT_MATERIAL_COVERAGE_FAILED/);}
});

test('coverage includes validated speaker evidence without synthesizing facts',()=>{const source='قال المجلس إن المدرسة افتتحت.';const x=validateMinimalExtraction({relevance:'POLITICAL_NEWS',actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:'المدرسة افتتحت.',context:source},speaker:{excerpt:'المجلس',context:source}}]},source);assert.deepEqual(validateNormalExtractionCoverage(source,x,undefined,[{unitId:'u1',nonFactual:false,factIds:['f1']}]),[{unitId:'u1',nonFactual:false,factIds:['f1']}]);});
import {createHash} from 'node:crypto';
import {checkpointProvider,type CheckpointStore} from '../src/worker/checkpoints';
import {ruleSet} from '../src/lib/processing/rules';
import {unknownProfile,type LanguageProvider} from '../src/lib/processing/contracts';
test('pre-coverage NORMAL checkpoints cannot bypass validation; completed current stage replays',async()=>{
 const input={content:'افتتح المجلس مدرسة جديدة.',publishedAt:new Date(0),profile:unknownProfile,rules:ruleSet};let calls=0;const provider:LanguageProvider={id:'offline',live:false,understand:async()=>{calls++;return {validated:true};},compare:async()=>({}),draft:async()=>({})};
 const old=createHash('sha256').update(JSON.stringify(['worker-normal-v2',provider.id,'understand',input])).digest('hex');const cache=new Map<string,unknown>([[old,{old:true}]]);const store:CheckpointStore={load:async k=>cache.has(k)?{output:cache.get(k)}:null,start:async()=>{},finish:async(k,v)=>{cache.set(k,v);}};const replay=checkpointProvider(provider,store);const signal=new AbortController().signal;
 assert.deepEqual(await replay.understand(input,signal),{validated:true});assert.deepEqual(await replay.understand(input,signal),{validated:true});assert.equal(calls,1);assert(cache.has(old));
});
