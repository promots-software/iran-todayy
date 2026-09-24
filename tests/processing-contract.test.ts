import {supportedLedger} from './fixtures/fidelity-review';
import {reviewedResponse} from './fixtures/direct-reviewed';
import {directFinalArticle} from '../src/lib/processing/direct-generation';
import test from 'node:test';
import assert from 'node:assert/strict';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {ProcessingError,unknownProfile,validateUnderstanding} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
import {validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {withOneRepair} from '../src/lib/processing/automatic-repair';
import {editorialDecision} from '../src/lib/processing/editorial-eligibility';
import {editoriallyFiltered,selectionBlocksDraft} from '../src/lib/processing/direct-policy';
import {finalizeWithRepair,finalizeConstrainedDraft} from '../src/lib/processing/local-finalization';
import {buildAtoms,renderSelection} from '../src/lib/processing/constrained-rewrite';
import {factualReviewPassed,renderingChecks} from '../src/lib/processing/rendering-contract';
import {newsroom} from './fixtures/newsroom';
import {minimalParts} from './fixtures/groq-minimal';
process.env.SHADOW_MODE='true';process.env.REQUIRE_APPROVAL='true';
const signal=()=>new AbortController().signal;
const source='أعلنت الجهة التجريبية في إيران اليوم إطلاق المرحلة الجديدة من مشروع اختباري لتطوير الخدمات الرقمية، مشيرةً إلى أن المرحلة الأولى ستبدأ الأسبوع المقبل في طهران. وأكدت أن هذا النص مخصص حصراً لاختبار نظام المعالجة والنشر الآلي ولا يمثل خبراً حقيقياً.';
const ev=(excerpt:string,context=source)=>({excerpt,context});
const raw=()=>({actors:[ev('الجهة التجريبية')],action:ev('إطلاق'),object:ev('الخدمات الرقمية'),location:ev('طهران'),event_time:null,statements:[{evidence:ev(source),speaker:ev('الجهة التجريبية','وأكدت أن هذا النص مخصص حصراً لاختبار نظام المعالجة والنشر الآلي ولا يمثل خبراً حقيقياً.'),kind:'STATEMENT',material:true}],safety:{filterReason:'SATIRE',priority:'P4',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false},coverage:[{unitId:'u1',factIds:['f1'],nonFactual:false}],publication:{title:{text:source,factIds:['f1']},body:[]}});
const response=(value:unknown)=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
const input=(content=source,processingMode:'NORMAL'|'DIRECT'='DIRECT')=>({content,processingMode,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet});
const held={autoPublish:false,shadowMode:true,requireApproval:true};
test('exact live context error is repaired from unique source evidence, preserving disclaimer',async()=>{
 let calls=0;const p=new GeminiLanguageProvider('offline',async(_url,init)=>{calls++;const {publication,...matching}=raw();return response(reviewedResponse(JSON.parse(String(init?.body)),matching,{title:publication.title.text,body:'',diagnostics:[]}));});
 const u=validateUnderstanding(await p.understand(input(),signal()),source);
 const d=await p.draft({content:source,processingMode:'DIRECT',understanding:u,rules:ruleSet},signal());
 void d;const final=directFinalArticle(source,u);
 assert.equal(calls,2);assert.equal(editorialDecision({validated:true,review:final.review},held).editorialEligibility,'READY_TO_PUBLISH');
 assert.match(final.title,/لا يمثل خبراً حقيقياً/);assert.equal(editoriallyFiltered(u,false,'DIRECT'),false);
});
test('context repair never guesses repeated evidence or invents a speaker',()=>{
 assert.throws(()=>resolveContextEvidence(ev('خبر','خبر خبر'),'خبر خبر'),/AMBIGUOUS_EVIDENCE_CONTEXT/);
 const x=raw();x.statements[0].speaker=ev('متحدث غير موجود');
 assert.throws(()=>validateMinimalExtraction({actors:x.actors,action:x.action,object:x.object,location:x.location,event_time:x.event_time,relevance:'POLITICAL_NEWS',statements:x.statements.map(({evidence,speaker})=>({evidence,speaker}))},source));
});
test('DIRECT diagnostic labels cannot replace the independent semantic-review receipt',async()=>{
 const {publication,...matching}=raw();let calls=0;
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{calls++;return response(reviewedResponse(JSON.parse(String(init?.body)),matching,{title:publication.title.text,body:'',diagnostics:['DIRECT_MATERIAL_COVERAGE_FAILED']}));});
 const u=validateUnderstanding(await p.understand(input(),signal()),source);
 await p.draft({content:source,processingMode:'DIRECT',understanding:u,rules:ruleSet},signal());
 assert.equal(calls,2);assert.equal(directFinalArticle(source,u).review[0].detail,'DIRECT_MATERIAL_COVERAGE_FAILED');assert.equal(u.directGeneration?.semanticVerification,'INDEPENDENT');
});
test('NORMAL relevance runs once; accepted Iran story survives priority and opinion labels',async()=>{
 const text='قال الوفد إن التعاون مع إيران سيستمر.';const u=newsroom(text,[text],'الوفد');u.relevance='POLITICAL_NEWS';u.priority='P4';u.filterReason='OPINION';const parts=minimalParts(u);Object.assign(parts[0],{contentType:'NEWS',contentTypeEvidence:{excerpt:text,context:text},coverage:[{unitId:'u1',factIds:['f1'],nonFactual:false}]});let calls=0;
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{calls++;const data=JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text);if(Array.isArray(data.publication))return response({fidelityLedger:supportedLedger(text,data.publication),review:data.publication.map((p:{id:string})=>({id:p.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[]});return response(calls<=2?parts[calls-1]:{coverage:[{unitId:'u1',factIds:['f1'],nonFactual:false}],publication:{title:{text:'إيران الآن | '+text.replace(/\.$/u,''),factIds:['f1']},body:[]}});});
 const result=validateUnderstanding(await p.understand(input(text,'NORMAL'),signal()),text);
 assert.equal(result.relevance,'POLITICAL_NEWS');assert.equal(editoriallyFiltered(result,false,'NORMAL'),false);assert.equal(selectionBlocksDraft(result,'NORMAL'),false);
 const draft=await p.draft({content:text,processingMode:'NORMAL',understanding:result,rules:ruleSet},signal());
 const final=finalizeConstrainedDraft(draft,text,result,unknownProfile);assert.equal(editorialDecision({validated:true,review:final.review},held).editorialEligibility,'READY_TO_PUBLISH');assert.equal(calls,4);
 assert.equal(editoriallyFiltered({...result,relevance:'IRRELEVANT'},false,'NORMAL'),true);
});
test('soft diagnostics cannot alone hold validated output; material checks and human review remain',()=>{
 for(const code of ['UNCERTAIN_SCOPE','AMBIGUOUS_EVIDENCE_CONTEXT','CONTEXT_REQUIRED','FORMAT_REVIEW','UNCOVERED_TERM','UNKNOWN_NAME','EDITORIAL_ATTESTATION_REQUIRED'])assert.equal(editorialDecision({validated:true,review:[{code}]},held).editorialEligibility,'READY_TO_PUBLISH',code);
 for(const code of ['UNSUPPORTED_OUTPUT','MATERIAL_FACT_OMISSION','NUMBER_MISMATCH','QUOTE_INTEGRITY_FAILURE','SPEAKER_ATTRIBUTION_MISMATCH','MATERIAL_EVIDENCE_UNRESOLVED','UNCERTAIN_MATCH'])assert.equal(editorialDecision({validated:true,review:[{code}]},held).editorialEligibility,'NEEDS_REVIEW',code);
 assert.equal(editorialDecision({validated:true,humanOverride:true},held).editorialEligibility,'NEEDS_REVIEW');
 const checks=Object.fromEntries(renderingChecks.map(k=>[k,true])) as Record<typeof renderingChecks[number],boolean>;
 assert(factualReviewPassed({id:'f1',verdict:'UNCERTAIN',checks,issues:['SOFT:STYLE']}));
 assert(!factualReviewPassed({id:'f1',verdict:'SUPPORTED',checks:{...checks,numbers:false},issues:['SOFT:STYLE']}));
 assert(!factualReviewPassed({id:'f1',verdict:'SUPPORTED',checks,issues:['material omission']}));
});
test('repair budget is one, transport failures never retried',async()=>{
 let count=0;await assert.rejects(withOneRepair(async()=>{count++;throw new ProcessingError('INVALID_EVIDENCE');},async()=>{count++;throw new ProcessingError('INVALID_EVIDENCE');}),/INVALID_EVIDENCE/);assert.equal(count,2);
 count=0;await assert.rejects(withOneRepair(async()=>{count++;throw new ProcessingError('GEMINI_HTTP_503');},async()=>{count++;return 1;}),/GEMINI_HTTP_503/);assert.equal(count,1);
});
test('deterministic draft repair reconstructs source facts and revalidates; invented underlying facts remain held',()=>{
 const text='أعلنت الوزارة في بيان أن المجلس وافق على 25 مقترحا.';const u=newsroom(text,[text]);const atoms=buildAtoms(text,u);const good=renderSelection({titleAtomId:'f1',bodyAtomIds:['f1']},atoms);const broken=structuredClone(good);broken.title+=' وزيادة العدد إلى 99';
 const repaired=finalizeWithRepair(broken,text,u,unknownProfile,true);assert(!repaired.title.includes('99'));assert.equal(editorialDecision({validated:true,review:repaired.review},held).editorialEligibility,'READY_TO_PUBLISH');
 const bad=structuredClone(u);bad.event.facts[0].arabic=text.replace('25','99');assert.throws(()=>finalizeWithRepair(broken,text,bad,unknownProfile,true));
});

test('clearly unrelated NORMAL source is excluded after one decision, without classification or rendering',async()=>{
 const text='أعلنت البلدية افتتاح مدرسة محلية في باريس.';let calls=0;
 const p=new GeminiLanguageProvider('offline',async()=>{calls++;return response({contentType:'NEWS',contentTypeEvidence:{excerpt:text,context:text},coverage:[{unitId:'u1',factIds:[],nonFactual:true}],relevance:'IRRELEVANT',actors:[],action:null,object:null,location:null,event_time:null,statements:[]});});
 const u=validateUnderstanding(await p.understand(input(text,'NORMAL'),signal()),text);
 assert.equal(u.relevance,'IRRELEVANT');assert.equal(editoriallyFiltered(u,false,'NORMAL'),true);assert.equal(calls,1);
});
