import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
import {validateSourceCoverage,validateObjectiveArticle} from '../src/lib/processing/direct-publication';
import {validateFidelityLedger} from '../src/lib/processing/fidelity-ledger';
import {numericTokens} from '../src/lib/processing/text-equivalence';
import {supportedLedger} from './fixtures/fidelity-review';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {unknownProfile,ProcessingError} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {normalStage} from '../src/lib/processing/normal-v2';
import {iranRelevanceInstructions} from '../src/lib/processing/iran-relevance';

test('unique whitespace projection preserves original evidence bytes and offsets',()=>{
 const source='وقع هجوما\u00a0 على الموقع.';
 const value={excerpt:'هجوما على الموقع',context:'وقع هجوما على الموقع.'};
 resolveContextEvidence(value,source);
 const e=value as typeof value&{start:number;end:number};
 assert.equal(e.excerpt,source.slice(e.start,e.end));assert.equal(e.excerpt,'هجوما\u00a0 على الموقع');
});
test('layout recovery never chooses an arbitrary repeated occurrence or changes letters',()=>{
 assert.throws(()=>resolveContextEvidence({excerpt:'وقع هجوم',context:'وقع هجوم'},'وقع\u00a0هجوم\nوقع\u00a0هجوم'),/AMBIGUOUS/);
 assert.throws(()=>resolveContextEvidence({excerpt:'وقف الهجوم',context:'وقع الهجوم'},'وقع الهجوم'),/INVALID_EVIDENCE/);
});
test('coverage links can be recovered from existing validated source occurrences',()=>{
 const source='افتتحت إيران مدرسة.';
 const facts=[{id:'f1',evidence:{excerpt:source,start:0,end:source.length}}];
 assert.deepEqual(validateSourceCoverage(source,{event:{facts}},[{unitId:'u1',factIds:[],nonFactual:false}])[0].factIds,['f1']);
 assert.throws(()=>validateSourceCoverage(source,{event:{facts}},[{unitId:'u1',factIds:['invented'],nonFactual:false}]),/COVERAGE/);
});
test('missing unique source unit is not fabricated as nonfactual',()=>{
 const source='افتتحت إيران مدرسة.\nأغلقت إيران مستشفى.';
 assert.throws(()=>validateSourceCoverage(source,{event:{facts:[{id:'f1',evidence:{excerpt:source.split('\n')[0],start:0,end:18}}]}},[{unitId:'u1',factIds:['f1'],nonFactual:false}]),/COVERAGE/);
});
test('Persian ordinal and Arabic compound ordinal have the same numeric value',()=>{
 assert.deepEqual(numericTokens('هشتاد و یکمین نشست'),['81']);
 assert.deepEqual(numericTokens('الدورة الحادية والثمانين'),['81']);
 assert.notDeepEqual(numericTokens('الدورة 82'),numericTokens('هشتاد و یکمین نشست'));
});
test('conceptual quote/number presentation needs independent semantic evidence, not literal equality',()=>{
 const source='قال الوزير: افتتحنا هشتاد و یکمین مرکز.';
 const publication=[{id:'title',text:'افتتاح المركز رقم 81'}];
 const ledger=supportedLedger(source,publication);
 assert.doesNotThrow(()=>validateObjectiveArticle(source,publication[0].text,'',ledger));
 ledger.claims[0].verdict='UNSUPPORTED' as 'SUPPORTED';
 assert.throws(()=>validateObjectiveArticle(source,publication[0].text,'',ledger),/FIDELITY/);
});
for(const defect of ['unsupported addition','changed number/unit/entity','changed date','wrong speaker','invented quote','stronger modality','invented causal context'])test('semantic '+defect+' cannot become READY',()=>{
 const source='أعلنت الوزارة الإيرانية افتتاح مدرسة.';
 const publication=[{id:'title',text:'افتتاح مدرسة'}],ledger=supportedLedger(source,publication);
 ledger.claims[0].verdict='UNSUPPORTED' as 'SUPPORTED';ledger.claims[0].explanation=defect;
 assert.throws(()=>validateFidelityLedger(source,publication,ledger),/FIDELITY/);
});
test('blanket reviewer success cannot hide unreviewed candidate clauses or omitted source units',()=>{
 const source='افتتحت إيران مدرسة.\nيفتح المركز غدا.';
 const p=[{id:'title',text:'افتتاح مدرسة'}],ledger=supportedLedger(source,p);
 assert.throws(()=>validateFidelityLedger(source,[{id:'title',text:p[0].text+' وقررت بناء مستشفى'}],ledger),/FIDELITY/);
 ledger.sourceCoverage.pop();assert.throws(()=>validateFidelityLedger(source,p,ledger),/FIDELITY/);
});
for(const code of ['AMBIGUOUS_EVIDENCE_CONTEXT','DIRECT_MATERIAL_COVERAGE_FAILED','INVALID_EVIDENCE','GEMINI_HTTP_503','PROVIDER_COST_WAIT'])test(code+' does not spend a speculative R1',async()=>{
 let calls=0;await assert.rejects(normalStage('extract',async()=>{calls++;throw new ProcessingError(code);},'نص'));assert.equal(calls,1);
});
for(const mode of ['DIRECT','NORMAL'] as const)for(const kind of ['foreign news','footer only','source identity only','speculative relationship'])test(mode+' filters '+kind+' from semantic verdict without writing/classification',async()=>{
 let calls=0;const source='افتتحت بلدية باريس مكتبة جديدة.\n@Iran_news';
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
  calls++;const r=JSON.parse(String(init?.body));assert(r.systemInstruction.parts[0].text.includes(iranRelevanceInstructions));
  const extraction={relevance:'IRRELEVANT',contentType:'NEWS',contentTypeEvidence:{excerpt:source,context:source},actors:[],action:null,object:null,location:null,event_time:null,statements:[],coverage:[{unitId:'u1',factIds:[],nonFactual:false},{unitId:'u2',factIds:[],nonFactual:true}]};
  const value=mode==='DIRECT'?{extraction:{...extraction,safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}},article:null}:extraction;
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
 });
 const u=await p.understand({content:source,processingMode:mode,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal);
 assert.equal(u.relevance,'IRRELEVANT');assert.equal(calls,1);
});
test('relevance contract explicitly accepts broad topics without a second importance gate',()=>{
 for(const category of ['sports','culture','religion','society','health','science','economy'])assert(iranRelevanceInstructions.includes(category));
 assert(iranRelevanceInstructions.includes('No importance'));assert(iranRelevanceInstructions.includes('BOTH'));
});
test('canonical 40-section contract remains byte-for-byte unchanged',()=>{
 const bytes=readFileSync('config/editorial/iran-now-contract.txt');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456');
 assert.equal([...bytes.toString('utf8').matchAll(/^(\d+)\. .+$/gm)].length,40);
});

// Frozen public-source cases from the completed replay; no provider/DB access.
import replayCases from './fixtures/replay-root-cases.json';
import {directMatchingUnderstanding} from '../src/lib/processing/direct-generation';
import {normalSelection,validateNormalExtractionCoverage} from '../src/lib/processing/normal-v2';
import {validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {classificationReferences} from '../src/lib/processing/id-classification';
import {validateRenderingProposal} from '../src/lib/processing/evidence-rendering';
import {fidelityRepairDiagnostics} from '../src/lib/processing/repair-diagnostics';
import {fixture} from './fixtures/processing';
for(const row of replayCases)test('frozen replay '+row.index+' preserves evidence boundary',()=>{
 const raw=row.outputs.find((o)=>'extraction' in o||'contentType' in o) as Record<string,unknown>;
 const verify=()=>{
  if(raw.extraction)return directMatchingUnderstanding(raw.extraction,row.sourceText,true);
  const p=normalSelection(raw,row.sourceText),x=validateMinimalExtraction(p.extraction,row.sourceText);
  validateNormalExtractionCoverage(row.sourceText,x,p.extraction,p.coverage,true);
  const rendering=row.outputs.find(o=>'entries' in o);
  if(rendering)validateRenderingProposal(classificationReferences(x).entries.filter(e=>e.role!=='event_time'),rendering);
 };
 if([402,413].includes(row.index))assert.throws(verify,/AMBIGUOUS_EVIDENCE_CONTEXT/);
 else assert.doesNotThrow(verify);
});
test('mixed repairable and uncertain review does not spend an AI repair',()=>{
 const f=fixture('uncertain','قال المسؤول إن الاجتماع انتهى.');
 const ledger=supportedLedger(f.content,[{id:'title',text:'انتهى الاجتماع'}]);
 ledger.claims[0].verdict='UNSUPPORTED' as 'SUPPORTED';
 ledger.sourceCoverage[0].disposition='UNCERTAIN' as 'PRESERVED';
 assert.deepEqual(fidelityRepairDiagnostics(ledger,f.content,f.understanding,{publication:{title:{text:'انتهى الاجتماع'}}}),[]);
});

import {groqSchema} from '../src/lib/processing/groq-context';
import {fidelityLedgerSchema} from '../src/lib/processing/fidelity-ledger-contract';
test('wire schema never turns candidate wording into source evidence',()=>{
 const schema=groqSchema('understand',fidelityLedgerSchema) as unknown as {properties:{claims:{items:{properties:Record<string,unknown>;required:string[]}}}};
 const claim=schema.properties.claims.items;
 assert(!('context' in claim.properties));assert(!claim.required.includes('context'));
 assert('excerpt' in claim.properties);
});

test('review excerpts tolerate unique line layout, while retaining exact candidate text',()=>{
 const source='افتتحت المدرسة. وبدأ التسجيل.';
 const publication=[{id:'title',text:'افتتحت المدرسة.\nوبدأ التسجيل.'}];
 const ledger=supportedLedger(source,publication);ledger.claims[0].excerpt='افتتحت المدرسة. وبدأ التسجيل.';
 const checked=validateFidelityLedger(source,publication,ledger);assert.equal(checked.claims[0].excerpt,publication[0].text);
 ledger.claims[0].excerpt='افتتحت المدرسة. وانتهى التسجيل.';assert.throws(()=>validateFidelityLedger(source,publication,ledger),/FIDELITY/);
});
test('source coverage can identify primary body while headline also cites it',()=>{
 const source='افتتحت مدرسة.';const p=[{id:'title',text:'افتتاح مدرسة'},{id:'body:1',text:source}];
 const ledger=supportedLedger(source,p);ledger.sourceCoverage[0].publicationIds=['body:1'];
 assert.deepEqual(new Set(validateFidelityLedger(source,p,ledger).sourceCoverage[0].publicationIds),new Set(['title','body:1']));
 ledger.sourceCoverage[0].disposition='MISSING' as 'PRESERVED';assert.throws(()=>validateFidelityLedger(source,p,ledger),/FIDELITY/);
});

import {matchEvent,type Candidate} from '../src/lib/processing/matcher';
import type {Understanding,LanguageProvider} from '../src/lib/processing/contracts';
for(const index of [31,219,287,388,435,459,238,390])test('frozen matching '+index+' requires occurrence evidence rather than topic similarity',async()=>{
 const row=replayCases.find(r=>r.index===index)!;
 const u=row.understanding as unknown as Understanding;
 const historical=row.match as unknown as {candidate:Candidate;evidence:{semantic:unknown;elapsedHours:number}};
 const c={...historical.candidate,publishedAt:new Date(historical.candidate.publishedAt)};
 const now=new Date(c.publishedAt.getTime()+historical.evidence.elapsedHours*3600000);
 const provider={compare:async()=>historical.evidence.semantic} as unknown as LanguageProvider;
 const result=await matchEvent(u.event,now,[c],provider,new AbortController().signal,{source:row.sourceText,understanding:u});
 assert.equal(result.classification,index===238?'DUPLICATE':'UNCERTAIN_MATCH');
});
import {scenarios,fixtureProvider} from './fixtures/processing';
for(const kind of ['FACT','CLAIM'] as const)test('source-grounded material '+kind+' survives matching without truth verification',async()=>{
 const incoming=structuredClone(scenarios.find(r=>r.id==='update')!),old=scenarios.find(r=>r.id==='telegram-a')!;
 incoming.understanding.event.facts[1].kind=kind;if(kind==='CLAIM')incoming.understanding.event.facts[1].speaker=structuredClone(incoming.understanding.event.actors[0]);incoming.understanding.event.facts.forEach(f=>f.verified=false);
 const now=new Date('2026-01-01T00:00:00Z'),c:Candidate={id:'old',revisionId:'old:1',revision:1,publishedAt:now,data:old.understanding.event,published:false};
 const result=await matchEvent(incoming.understanding.event,now,[c],fixtureProvider(),new AbortController().signal,{source:incoming.content,understanding:incoming.understanding});
 assert.equal(result.classification,'MATERIAL_UPDATE');assert.deepEqual(result.newFactIds,['update:agreement']);
});

import temporalFalseAccept from './fixtures/replay-temporal-false-accept.json';
// Deliberately retains the measured acceptance failure as a red release gate.
// Do not weaken this expectation or label model approval as factual correctness.
test('recorded independent review must reject unsupported temporal continuity',()=>{
 assert.throws(()=>validateFidelityLedger(temporalFalseAccept.source,temporalFalseAccept.publication,temporalFalseAccept.ledger),/FIDELITY/);
});
