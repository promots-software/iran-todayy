import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {directMatchingUnderstanding} from '../src/lib/processing/direct-generation';
import {validateSpeakerEvidence} from '../src/lib/processing/speaker-evidence';
import {normalSelection,validateNormalExtractionCoverage,normalStage} from '../src/lib/processing/normal-v2';
import {validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {ProcessingError} from '../src/lib/processing/contracts';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/natural-extraction-wave.json',import.meta.url),'utf8')) as {post:string;mode:string;source:string;responses:unknown[]}[];
for(const f of fixtures.filter(f=>f.mode==='DIRECT'))test('saved natural title/name attribution '+f.post,()=>{
 const u=directMatchingUnderstanding(f.responses[0],f.source);assert(u.event.facts.length);assert(u.event.facts.every(x=>x.verified===false));
 for(const fact of u.event.facts){assert.equal(f.source.slice(fact.evidence.start,fact.evidence.end),fact.evidence.excerpt);assert(fact.speaker);}
});
const evidence=(source:string,text:string)=>({excerpt:text,start:source.indexOf(text),end:source.indexOf(text)+text.length});
for(const prefix of ['أمين المجلس المحلي، ','مدير المجلس الأعلى ','اللواء '])test('generic title prefix '+prefix,()=>{
 const s=prefix+'أحمد سالم:\n\nافتتحت المدرسة. بدأ التسجيل.';validateSpeakerEvidence(s,evidence(s,'بدأ التسجيل.'),evidence(s,'أحمد سالم'));
});
for(const prefix of ['اتهم الوزير ','قال الوزير عن ','وزير الخارجية والوزير ','أمين المجلس قتل ','ذكرت الوكالة '])test('ambiguous or competing voice still fails '+prefix,()=>{
 const s=prefix+'أحمد سالم:\n\nافتتحت المدرسة.';assert.throws(()=>validateSpeakerEvidence(s,evidence(s,'افتتحت المدرسة.'),evidence(s,'أحمد سالم')),/SPEAKER_ATTRIBUTION_MISMATCH/);
});
test('new attributed voice terminates header scope',()=>{const s='أمين المجلس المحلي أحمد سالم:\n\nقال الوزير خالد إن المدرسة مغلقة. افتتحت المدرسة.';assert.throws(()=>validateSpeakerEvidence(s,evidence(s,'افتتحت المدرسة.'),evidence(s,'أحمد سالم')),/SPEAKER_ATTRIBUTION_MISMATCH/);});
test('missing colon remains uncertain',()=>{const s='أمين المجلس المحلي أحمد سالم\n\n- افتتحت المدرسة.';assert.throws(()=>validateSpeakerEvidence(s,evidence(s,'افتتحت المدرسة.'),evidence(s,'أحمد سالم')),/SPEAKER_ATTRIBUTION_MISMATCH/);});
for(const f of fixtures.filter(f=>f.mode==='NORMAL'))test('saved NORMAL incomplete or ambiguous evidence remains blocked '+f.post,()=>{
 assert.throws(()=>{const x=validateMinimalExtraction(normalSelection(f.responses.at(-1),f.source).extraction,f.source);validateNormalExtractionCoverage(f.source,x);},ProcessingError);
});
test('bounded repair remains one even for natural repeated failures',async()=>{let calls=0;await assert.rejects(normalStage('extract',async()=>{calls++;throw new ProcessingError('INVALID_EVIDENCE');}),/AI_SCHEMA_REPAIR_FAILED/);assert.equal(calls,2);});

import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
test('non-verbatim action is distinguished from a repeated location',()=>{
 assert.throws(()=>resolveContextEvidence({excerpt:'نشرت... تدوينة',context:'نشرت الوكالة اليوم تدوينة.'},'نشرت الوكالة اليوم تدوينة.'),/INVALID_EVIDENCE/);
 assert.throws(()=>resolveContextEvidence({excerpt:'المدينة',context:'زار المدينة ثم عاد إلى المدينة.'},'زار المدينة ثم عاد إلى المدينة.'),/AMBIGUOUS_EVIDENCE_CONTEXT/);
});
test('entire missing unit carries exact repair offsets',()=>{
 const source='أصيب ثلاثة أشخاص.\nافتتحت المدرسة.';const x=validateMinimalExtraction({relevance:'POLITICAL_NEWS',actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:'افتتحت المدرسة.',context:source},speaker:null}]},source);
 assert.throws(()=>validateNormalExtractionCoverage(source,x),(e:unknown)=>{assert(e instanceof ProcessingError);assert(e.diagnostic&&'issues'in e.diagnostic);assert.deepEqual(e.diagnostic.issues[0].path,['sourceUnits','u1','start',0,'end',17]);return true;});
});
test('NORMAL shares grounded title/name grammar without exempting its title from coverage',()=>{
 const source='أمين المجلس المحلي أحمد سالم:\n\nافتتحت المدرسة.';const x=validateMinimalExtraction({relevance:'POLITICAL_NEWS',actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:'افتتحت المدرسة.',context:source},speaker:{excerpt:'أحمد سالم',context:source}}]},source);
 assert.equal(x.statements[0].speaker?.excerpt,'أحمد سالم');assert.throws(()=>validateNormalExtractionCoverage(source,x),/DIRECT_MATERIAL_COVERAGE_FAILED/);
});
test('DIRECT wrapper preserves the exact failing speaker field',()=>{
 const source='ذكر الوزير أحمد سالم:\n\nافتتحت المدرسة.';const e=(excerpt:string)=>({excerpt,context:source});
 assert.throws(()=>directMatchingUnderstanding({actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:e('افتتحت المدرسة.'),speaker:e('أحمد سالم'),kind:'CLAIM',material:true}],safety:{priority:'P3',filterReason:'NONE',leaderDeath:false,seriousClaim:false,rankUnverified:false,sensitiveActor:false}},source),(err:unknown)=>{assert(err instanceof ProcessingError);assert.equal(err.code,'DIRECT_MATCH_INPUT_INVALID');assert(err.diagnostic&&'field'in err.diagnostic);assert.equal(err.diagnostic.field,'statements.f1.speaker');return true;});
});
test('single repair receives the schema-checked candidate, retaining unaffected evidence',async()=>{
 const f=fixtures.find(f=>f.post==='19707')!;let calls=0;
 await assert.rejects(normalStage('extract',async repair=>{calls++;if(repair){assert.deepEqual(repair.previousOutput,normalSelection(f.responses[0],f.source).extraction);assert.equal(repair.code,'INVALID_EVIDENCE');assert.deepEqual(repair.issues,[{code:'INVALID_EVIDENCE',path:['action']}]);}return validateMinimalExtraction(normalSelection(f.responses[0],f.source).extraction,f.source);}),/AI_SCHEMA_REPAIR_FAILED/);
 assert.equal(calls,2);
});
