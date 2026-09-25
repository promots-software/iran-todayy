import {renderingChecks} from '../src/lib/processing/rendering-contract';
import test from 'node:test';
import assert from 'node:assert/strict';
import {AssumedPropositionGemini as GeminiLanguageProvider} from './fixtures/proposition-mock';
import {ProcessingError,unknownProfile} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {combinedFixture,reviewedFixture} from './fixtures/current-direct';
import {geminiEnvelope} from './fixtures/direct-bilingual';
import {numericTokens,dateTokens} from '../src/lib/processing/text-equivalence';
import {validateObjectiveArticle} from '../src/lib/processing/direct-publication';
import {iranRelevanceInstructions} from '../src/lib/processing/iran-relevance';
import {editorialContract} from '../src/lib/processing/editorial-contract';

// Reviewer decisions are explicitly authored per case, never evidence of live model competence.
async function run(mode:'NORMAL'|'DIRECT',source:string,versions:string[],options:{reject?:string;irrelevant?:boolean;title?:string}={}){
 const calls:string[]=[],repairs:unknown[]=[];let generations=0;
 const transport:typeof fetch=async(_url,init)=>{
  const req=JSON.parse(String(init?.body)),props=req.generationConfig.responseJsonSchema.properties,data=JSON.parse(req.contents[0].parts[0].text);
  const response=(v:unknown)=>Response.json(geminiEnvelope(v));
  const combined=combinedFixture(source,versions[Math.min(generations,versions.length-1)],options.title??'إيران الآن | خبر من إيران');
  if(props.extraction||props.contentType){
   assert(req.systemInstruction.parts[0].text.includes(iranRelevanceInstructions));
   if(options.irrelevant)combined.extraction.relevance='IRRELEVANT';
   if(props.extraction){calls.push('generation');generations++;if(data.repair)repairs.push(data.repair);return response({...combined,article:options.irrelevant?null:combined.article});}
   calls.push('extract');const {safety,statements,...rest}=combined.extraction;void safety;return response({...rest,statements:statements.map(({evidence,speaker})=>({evidence,speaker}))});
  }
  if(props.entries){calls.push('translation');return response({entries:data.references.map((r:{id:string;source:string})=>({id:r.id,arabic:r.source}))});}
  if(data.references){calls.push('translation_review');return response({review:data.references.map((r:{id:string})=>({id:r.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]}))});}
  if(props.anchorIds){calls.push('classify');return response({anchorIds:[],factLabels:[{id:'f1',kind:'FACT',material:true}],filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:['f1']});}
  if(props.publication){calls.push('generation');generations++;if(data.repair)repairs.push(data.repair);return response({coverage:combined.extraction.coverage,publication:{title:{text:combined.article.title,factIds:['f1']},body:[{text:combined.article.body,factIds:['f1']}]}});}
  assert(req.systemInstruction.parts[0].text.includes(editorialContract));calls.push('review');const review=reviewedFixture(source,data.publication);
  if(options.reject)for(const claim of review.fidelityLedger.claims)if(claim.excerpt.includes(options.reject)){claim.verdict='UNSUPPORTED' as 'SUPPORTED';claim.components[0].verdict='UNSUPPORTED';claim.explanation='Explicit fixture: wrong speaker/value association against original source.';}
  if(mode==='NORMAL'){const {comparisons,...normal}=review;void comparisons;return response(normal);}return response(review);
 };
 const completed=new Map<string,Response>();
 const makeProvider=()=>new GeminiLanguageProvider('offline',async(url,init)=>{const key=String(init?.body);const cached=completed.get(key);if(cached){const response=cached.clone();response.headers.set('x-worker-checkpoint-replayed','true');return response;}const response=await transport(url,init);completed.set(key,response.clone());return response;});
 let provider=makeProvider();
 const input={processingMode:mode,content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet};
 for(let continuation=0;continuation<2;continuation++){try{const u=await provider.understand(input,new AbortController().signal);if(u.relevance==='IRRELEVANT')return {calls,repairs,u,draft:null,error:null};const draft=await provider.draft({...input,understanding:u},new AbortController().signal);return {calls,repairs,u,draft,error:null};}
 catch(error){if(continuation===0&&error instanceof ProcessingError&&error.code==='APPLICATION_CONTINUATION_BUDGET'){provider=makeProvider();continue;}return {calls,repairs,u:null,draft:null,error};}}
 throw Error('OFFLINE_CONTINUATION_EXHAUSTED');
}
for(const [left,right] of [['12','١٢'],['۱۲','12'],['12.5','١٢٫٥'],['1٬234','1234'],['4.50','٤٫٥'],['4.00','4']])test('equivalent numeric representation '+left+' / '+right,()=>assert.deepEqual(numericTokens(left),numericTokens(right)));
test('date month synonyms retain day/year/calendar',()=>{assert.deepEqual(dateTokens('12 أكتوبر 2025'),dateTokens('١٢ تشرين الأول ٢٠٢٥'));assert.notDeepEqual(dateTokens('12 أكتوبر 2025'),dateTokens('13 أكتوبر 2025'));assert.notDeepEqual(dateTokens('12 أكتوبر 2025'),dateTokens('12 أكتوبر 2026'));assert.notDeepEqual(dateTokens('12 أكتوبر'),dateTokens('12 أكتوبر 2025'));assert.notDeepEqual(dateTokens('12 أكتوبر هجري'),dateTokens('12 أكتوبر'));});
for(const [source,bad] of [['أحصت إيران 12 طائرة.','أحصت إيران 21 طائرة.'],['أعلنت إيران الخطة في 2025.','أعلنت إيران الخطة في 2026.'],['شارك في إيران 3 أشخاص.','شارك في إيران 4 أشخاص.'],['بلغ السعر في إيران $4.','بلغ السعر في إيران $40.'],['بلغ المعدل في إيران 12%.','بلغ المعدل في إيران 12.5%.'],['الموعد في إيران 12 أكتوبر 2025.','الموعد في إيران 13 أكتوبر 2025.'],['الموعد في إيران 12 أكتوبر 2025.','الموعد في إيران 12 نوفمبر 2025.']])for(const mode of ['DIRECT','NORMAL'] as const)test(mode+' objective defect before review and R1 corrects '+bad,async()=>{
 assert.throws(()=>validateObjectiveArticle(source,'إيران الآن | خبر من إيران',bad));const r=await run(mode,source,[bad,source]);assert.equal(r.error,null,String(r.error));assert.equal(r.calls.filter(c=>c==='generation').length,2);assert.equal(r.calls.filter(c=>c==='review').length,1);assert.equal(r.repairs.length,1);assert(r.draft?.body.includes(source));
 const repair=r.repairs[0] as {cycle:number;diagnostics:{factIds:string[];sourceSpans:{text:string}[];allowedPaths:unknown[]}[]};assert.equal(repair.cycle,1);assert.deepEqual(repair.diagnostics[0].factIds,['f1']);assert(repair.diagnostics[0].sourceSpans.some(e=>e.text===source));assert.equal(repair.diagnostics[0].allowedPaths.length,1);
});
for(const mode of ['DIRECT','NORMAL'] as const){
 test(mode+' number remains wrong: bounded stop, no paid review',async()=>{const r=await run(mode,'أحصت إيران 12 طائرة.',['أحصت إيران 21 طائرة.','أحصت إيران 22 طائرة.','أحصت إيران 23 طائرة.']);assert(r.error);assert(r.calls.filter(c=>c==='generation').length<=3);assert.equal(r.calls.filter(c=>c==='review').length,0);assert.equal(r.draft,null);});
 test(mode+' numeric R1 then independent attribution R2 passes',async()=>{const source='أحصت إيران 12 طائرة.';const r=await run(mode,source,['أحصت إيران 21 طائرة.','أحصت إيران 12 طائرة بحسب مصادر مجهولة.',source],{reject:'مصادر مجهولة'});assert.equal(r.error,null,String(r.error));assert.equal(r.calls.filter(c=>c==='generation').length,3);assert.equal(r.repairs.length,2);});
 for(const corrected of [false,true])test(mode+' intervening speaker association '+corrected,async()=>{const source='قال المسؤول الإيراني أحمد إن الاجتماع بدأ. ثم قالت المتحدثة الإيرانية ليلى: سيستمر الاجتماع غداً.';const bad='قال المسؤول الإيراني أحمد إن الاجتماع بدأ وإنه سيستمر غداً.';const r=await run(mode,source,corrected?[bad,source]:[bad],{reject:'وإنه سيستمر'});if(corrected){assert.equal(r.error,null,String(r.error));assert.equal(r.repairs.length,1);}else{assert(r.error);assert.equal(r.draft,null);}assert(r.calls.includes('review'));});
 test(mode+' equal numeric multiset cannot authorize entity swap',async()=>{const source='أحصت إيران 3 طائرات و4 سفن.';const r=await run(mode,source,['أحصت إيران 4 طائرات و3 سفن.'],{reject:'4 طائرات'});assert(r.error);assert.equal(r.draft,null);});
 test(mode+' equivalent date representation passes',async()=>{const r=await run(mode,'الموعد في إيران 12 أكتوبر 2025.',['الموعد في إيران ١٢ تشرين الأول ٢٠٢٥.']);assert.equal(r.error,null,String(r.error));assert.equal(r.repairs.length,0);});
}
for(const [category,source] of [['sports','فاز منتخب إيران في المباراة.'],['economics','ارتفع الإنتاج الصناعي في إيران.'],['politics','أقر البرلمان الإيراني القانون.'],['diplomacy','التقى الوزير الإيراني نظيره في بغداد.'],['military','أعلنت إيران إجراء مناورات بحرية.'],['culture','افتتح معرض للكتب في طهران.']])for(const mode of ['NORMAL','DIRECT'] as const)test(mode+' semantic intake retains material Iran '+category,async()=>{const r=await run(mode,source,[source]);assert.equal(r.error,null,String(r.error));assert.equal(r.u?.relevance,'POLITICAL_NEWS');assert(r.draft);});
for(const mode of ['NORMAL','DIRECT'] as const)for(const source of ['إيران الآن | افتتاح مدرسة في باريس.','وصل الوزير الفرنسي إلى لندن.'])test(mode+' explicit semantic unrelated/branding outcome stops before drafting '+source,async()=>{const r=await run(mode,source,[source],{irrelevant:true});assert.equal(r.error,null);assert.equal(r.u?.filterReason,'UNRELATED_TO_IRAN');assert.equal(r.draft,null);assert(!r.calls.includes('review'));assert(!r.calls.includes('classify'));});
