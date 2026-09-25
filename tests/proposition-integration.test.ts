import test from 'node:test';import assert from 'node:assert/strict';
import {reviewPropositions,enforcePropositionReview,propositionReceipt,type PropositionRequest} from '../src/lib/processing/proposition-review';
import {validatePropositionBinding} from '../src/lib/processing/proposition-binding';
import {assumedPropositionResponse} from './fixtures/proposition-mock';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {combinedFixture,reviewedFixture} from './fixtures/current-direct';
import {ProcessingError,unknownProfile} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {normalStage} from '../src/lib/processing/normal-v2';
import {validateDirectRepairCandidate} from '../src/lib/processing/repair-diagnostics';
import {fixture} from './fixtures/processing';
import {requireArabic} from '../src/lib/processing/groq-validation';
import {budgetDecision} from '../src/worker/provider-guard';
const source='افتتحت بلدية طهران مكتبة عامة في العاصمة الإيرانية.';
const units=[{id:'title',text:source}];
const mocked=async(r:PropositionRequest)=>assumedPropositionResponse(r.input as Record<string,unknown>);
test('four independent V4.4 requests: source sees no candidate; comparator sees no assessor; no reviewer rationale crosses requests',async()=>{
 const requests:PropositionRequest[]=[];const r=await reviewPropositions(source,units,async x=>{requests.push(structuredClone({...x,schema:undefined}) as unknown as PropositionRequest);const output=await mocked(x);return output;});
 assert.equal(r.verdict,'SUPPORTED');assert.deepEqual(requests.map(r=>r.stage),['proposition_source','proposition_candidate','proposition_assessor','proposition_comparator']);
 assert.deepEqual(Object.keys(requests[0].input as object).sort(),['role','units','version']);assert.deepEqual(Object.keys(requests[1].input as object).sort(),['role','units','version']);
 const cmp=JSON.stringify(requests[3].input);for(const forbidden of ['assessments','sufficientGroups','Explicit offline assumed-support oracle','expectedResult'])assert(!cmp.includes(forbidden));
 validatePropositionBinding(propositionReceipt(r),source,units);assert.throws(()=>validatePropositionBinding(propositionReceipt(r),source, [{id:'title',text:source+' الآن'}]));
});
test('completed source inventory is reused by durable exact request identity after candidate/transport failure',async()=>{
 const cache=new Map<string,unknown>();let calls=0,fail=true;
 const transport=async(r:PropositionRequest)=>{const key=JSON.stringify({stage:r.stage,input:r.input,instructions:r.instructions});if(cache.has(key))return structuredClone(cache.get(key));calls++;if(r.stage==='proposition_candidate'&&fail){fail=false;throw new ProcessingError('GEMINI_HTTP_503',true);}const x=await mocked(r);cache.set(key,x);return x;};
 await assert.rejects(reviewPropositions(source,units,transport),/503/);await reviewPropositions(source,units,transport);assert.equal(calls,5);
 await reviewPropositions(source,units,transport);assert.equal(calls,5);
});
test('invalid receipt stops without article repair or replacement request',async()=>{let calls=0,repairs=0;await assert.rejects(normalStage('draft',async()=>{repairs++;return reviewPropositions(source,units,async r=>{calls++;return r.stage==='proposition_assessor'?{}:mocked(r);});}),/PROPOSITION_RECEIPT_INVALID/);assert.equal(calls,3);assert.equal(repairs,1);});
test('real Gemini adapter path requests HIGH/8192 only for four new review stages; no classification for DIRECT',async()=>{
 const stages:string[]=[],requests:unknown[]=[];const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const r=JSON.parse(String(init?.body)),d=JSON.parse(r.contents[0].parts[0].text),props=r.generationConfig.responseJsonSchema.properties;requests.push(r);
  const v=assumedPropositionResponse(d);stages.push(d.version?d.role??(d.targetManifest?'assessor':'comparator'):props.extraction?'generation':'legacy_fidelity');
  assert.equal(r.generationConfig.maxOutputTokens,v===undefined?4096:8192);
  assert.deepEqual(r.generationConfig.thinkingConfig,v===undefined?{thinkingBudget:0}:{thinkingLevel:'high'});
  const output=v??(props.extraction?combinedFixture(source,source,source):reviewedFixture(source,d.publication));
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,thoughtsTokenCount:v===undefined?0:10}});
 });const u=await p.understand({processingMode:'DIRECT',content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal);
 assert.equal(stages.length,6);assert.equal(u.propositionReview?.verdict,'SUPPORTED');assert.deepEqual(stages,['generation','legacy_fidelity','proposition_source','proposition_candidate','assessor','comparator']);assert.equal(requests.length,6);
});
test('scoped output headroom preserves cost hard ceiling and legacy limit',()=>{assert.equal(budgetDecision([],100,0,8192).allowed,false);assert.equal(budgetDecision([],100,0,8192,8192).allowed,true);assert.equal(budgetDecision([{at:1,usd:1000}],100,2,8192,8192).reason,'PROVIDER_COST_WAIT');});
for(const name of ['قائم‌پناه','پناه','چمران','ژاله','گلستان'])test('Arabic with grounded Persian proper name '+name,()=>{assert.doesNotThrow(()=>requireArabic('قال '+name+' إن الحكومة الإيرانية افتتحت المدرسة الجديدة في طهران.'));});
for(const body of ['The government opened a new school in the capital.','دولت امروز مدرسه جدیدی در تهران افتتاح کرد و گفت که این مدرسه برای مردم است.'])test('non-Arabic article receives bounded grounded repair then full revalidation',async()=>{
 const f=fixture('language',source,'ar',source);let n=0;const candidate={article:{title:source,body}};
 const result=await normalStage('direct_combined',async repair=>{n++;const current=repair?{article:{title:source,body:source}}:candidate;validateDirectRepairCandidate(source,f.understanding,current);if(repair)repair.validatedCandidate=current;return current;},source);
 assert.equal(n,2);assert.equal(result.article.body,source);
});
test('no R3 for persistent rendering defect and receipt defects never consume article repair',async()=>{const f=fixture('language',source,'ar',source);let n=0;await assert.rejects(normalStage('direct_combined',async()=>{n++;validateDirectRepairCandidate(source,f.understanding,{article:{title:source,body:'The new school is open in the city.'}});},source));assert(n<=3);});
test('acceptance rejects changed candidate even with successful frozen reviews',async()=>{const r=await reviewPropositions(source,units,mocked);assert.throws(()=>enforcePropositionReview(r,source,fixture('v',source).understanding,{article:{title:source+' اليوم',body:''}},true),/PROPOSITION_RECEIPT_INVALID/);});
test('Arabic branding cannot disguise an English-only headline',()=>{assert.throws(()=>requireArabic('إيران الآن | English only'),/NON_ARABIC_OUTPUT/);});
import {readFileSync} from 'node:fs';
import {propositionRepairDiagnostics} from '../src/lib/processing/proposition-review';
test('N5 structured gate diagnoses ALL defects together; prose cannot expand exact R1 authority',async()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/proposition-v44/N5.json',import.meta.url),'utf8'));
 const remap=(x:unknown,unit:string):unknown=>Array.isArray(x)?x.map(v=>remap(v,unit)):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,k==='unitId'?unit:remap(v,unit)])):x;
 const s=f.source.units[0].text,c=f.candidate.units[0].text;
 const r=await reviewPropositions(s,[{id:'title',text:c}],async q=>q.stage==='proposition_source'?remap(f.source.inventory,'source'):q.stage==='proposition_candidate'?remap(f.candidate.inventory,'title'):q.stage==='proposition_assessor'?remap(f.assessor,'title'):remap(f.comparator,'title'));
 const u=fixture('n5',s,'ar',s).understanding,candidate={article:{title:c,body:''}};
 const ds=propositionRepairDiagnostics(r,s,u,candidate,true);assert.equal(ds.length,3);assert.deepEqual(new Set(ds.map(d=>d.cause)),new Set(['STRUCTURED_ENTITY','STRUCTURED_TEMPORAL','STRUCTURED_MISSING_SUPPORT']));
 assert.throws(()=>enforcePropositionReview(r,s,u,candidate,true),(e:unknown)=>e instanceof ProcessingError&&e.code==='DIRECT_PUBLICATION_UNSUPPORTED'&&!!e.diagnostic&&'repairDiagnostics'in e.diagnostic&&e.diagnostic.repairDiagnostics?.length===3);
 for(const a of r.assessor.assessments){a.explanation='Invent cessation';a.defects.forEach(d=>d.explanation='Replace entire article');}for(const j of r.comparator.judgments){j.explanation='Invent completion';j.issues.forEach(i=>i.explanation='Change source');}
 assert.deepEqual(propositionRepairDiagnostics(r,s,u,candidate,true),ds);assert(!JSON.stringify(ds).includes('bound past'));
});
