import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalCheckSchema,validateCanonicalCheck,runCanonicalFlow,type CanonicalCheck} from '../src/lib/processing/canonical-flow';
import {groqSchema} from '../src/lib/processing/groq-context';
import {geminiWireSchema} from '../src/lib/processing/gemini-wire-schema';
import {compactCanonicalGeminiWireSchema,decodeCompactCanonicalGeminiReceipt,encodeCompactCanonicalReceipt} from '../src/lib/processing/gemini-canonical-wire';
import {EDITORIAL_CONTRACT_SHA256,editorialContract} from '../src/lib/processing/editorial-contract';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
const check=():CanonicalCheck=>({sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:'PASS',defects:[]}]))});
const defect={defect:'Unsupported addition',correction:'Remove added phrase',sourceQuote:null,articleQuote:'added'};
test('wire schema is compact but keeps original failure diagnosis fields and the full contract binding',()=>{
 const original=geminiWireSchema(groqSchema('understand',canonicalCheckSchema));const before=structuredClone(original);const wire=compactCanonicalGeminiWireSchema(original) as {properties:{contract:{enum:string[]};statuses:unknown;diagnoses:unknown}};
 assert.deepEqual(original,before);assert.deepEqual(wire.properties.contract.enum,[EDITORIAL_CONTRACT_SHA256]);assert(wire.properties.statuses);assert(wire.properties.diagnoses);assert(JSON.stringify(wire).length<JSON.stringify(original).length/10);
});
test('all 40 statuses and multiple exact failure diagnoses round trip',()=>{
 const c=check();c.sections['1']={status:'FAIL',defects:[defect,{...defect,correction:'Another exact correction'}]};c.sections['22']={status:'NOT_APPLICABLE',defects:[]};c.sections['40']={status:'FAIL',defects:[defect]};
 const decoded=JSON.parse(decodeCompactCanonicalGeminiReceipt(JSON.stringify(encodeCompactCanonicalReceipt(c))));assert.deepEqual(decoded,c);assert.deepEqual(validateCanonicalCheck(decoded,'source',{title:'added',body:''}),c);
});
for(const kind of ['missing','extra','invalidStatus','nullStatus','missingStatuses','missingContract','wrongContract','missingDiagnoses','missingFailure','emptyFailure','extraDiagnosis','unknownDiagnosis','duplicateDiagnosis','missingQuote','noQuotes','extraField','section40NA','legacyRows'] as const)test('compact receipt fails closed: '+kind,()=>{
 const c=check();c.sections['1']={status:'FAIL',defects:[defect]};const r=encodeCompactCanonicalReceipt(c) as unknown as Record<string,unknown>;const statuses=r.statuses as unknown[],diagnoses=r.diagnoses as {sectionId:string;defects:Record<string,unknown>[]}[];
 if(kind==='missing')statuses.pop();if(kind==='extra')statuses.push('P');if(kind==='invalidStatus')statuses[0]='PASS';if(kind==='nullStatus')statuses[0]=null;if(kind==='missingStatuses')delete r.statuses;if(kind==='missingContract')delete r.contract;if(kind==='wrongContract')r.contract='0'.repeat(64);if(kind==='missingDiagnoses')delete r.diagnoses;if(kind==='missingFailure')r.diagnoses=[];if(kind==='emptyFailure')diagnoses[0].defects=[];if(kind==='extraDiagnosis')diagnoses.push({sectionId:'2',defects:[defect]});if(kind==='unknownDiagnosis')diagnoses[0].sectionId='41';if(kind==='duplicateDiagnosis')diagnoses.push(diagnoses[0]);if(kind==='missingQuote')delete diagnoses[0].defects[0].sourceQuote;if(kind==='noQuotes'){diagnoses[0].defects[0].sourceQuote=null;diagnoses[0].defects[0].articleQuote=null;}if(kind==='extraField')r.overall='PASS';if(kind==='section40NA')statuses[39]='N';
 assert.throws(()=>decodeCompactCanonicalGeminiReceipt(JSON.stringify(kind==='legacyRows'?{sections:[]}:r)),/CANONICAL_CHECK_INVALID/);
});
test('truncated JSON cannot become a pass',()=>assert.throws(()=>decodeCompactCanonicalGeminiReceipt(JSON.stringify(encodeCompactCanonicalReceipt(check())).slice(0,-1)),/CANONICAL_CHECK_INVALID/));
test('actual native adapter rejects non-STOP finish before receipt reconstruction',async()=>{
 const provider=new GeminiLanguageProvider('offline',async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(encodeCompactCanonicalReceipt(check()))}]}}]}),()=>{},true);
 await assert.rejects(provider.canonicalRequest({stage:'canonical_check',schema:canonicalCheckSchema,instructions:'unchanged',input:{}},new AbortController().signal),/GEMINI_INCOMPLETE/);
});
test('actual native compact checks preserve V0/R1/R2, full 40 rechecks, full contract and no R3',async()=>{
 const stages:string[]=[],diagnoses:unknown[]=[];let checks=0;
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const body=JSON.parse(String(init?.body)),input=JSON.parse(body.contents[0].parts[0].text),isCheck=!!body.generationConfig.responseJsonSchema.properties.statuses;
  assert.equal(body.generationConfig.maxOutputTokens,4096);assert.deepEqual(body.generationConfig.thinkingConfig,{thinkingBudget:0});
  let output:unknown;
  if('source'in input){stages.push('intake');output={iranRelated:true,rationale:'Iran'};}
  else{assert(body.systemInstruction.parts[0].text.includes(editorialContract));if(isCheck){stages.push('check');checks++;const c=check();c.sections['1']={status:'FAIL',defects:[defect]};c.sections['40']={status:'FAIL',defects:[defect]};output=encodeCompactCanonicalReceipt(c);}else{stages.push(input.currentArticle?'repair':'generate');if(input.currentArticle)diagnoses.push(input.failures);output={title:'added',body:'source'};}}
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:0,candidatesTokenCount:0}});
 },()=>{},true);
 const result=await runCanonicalFlow('Iran source',r=>provider.canonicalRequest(r,new AbortController().signal));assert.equal(result.status,'NEEDS_REVIEW');assert.equal(checks,3);assert.deepEqual(stages,['intake','generate','check','repair','check','repair','check']);assert.equal(diagnoses.length,2);for(const d of diagnoses)assert.deepEqual(d,[{section:1,defects:[defect]},{section:40,defects:[defect]}]);
});
