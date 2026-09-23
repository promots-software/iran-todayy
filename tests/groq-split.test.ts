import test from 'node:test';
import assert from 'node:assert/strict';
import {GroqLanguageProvider} from '../src/lib/processing/groq';
import {fixture,official} from './fixtures/processing';
import {minimalParts} from './fixtures/groq-minimal';
import {ruleSet} from '../src/lib/processing/rules';
import {minimalExtractionSchema,validateMinimalExtraction,requireCompleteExtraction} from '../src/lib/processing/groq-extraction';
import {classificationReferences,idClassificationInput,adaptIdClassification} from '../src/lib/processing/id-classification';
const sample=fixture('split','قال عباس عراقجي في طهران إنه يزور المدينة');
const input={content:sample.content,publishedAt:new Date(),profile:official,rules:ruleSet};
const response=(value:unknown)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:50}});
test('minimal contract omits generated content and preserves unknowns without manufacturing statements',()=>{
 assert.deepEqual(Object.keys(minimalExtractionSchema.shape),['relevance','actors','action','object','location','event_time','statements']);
 const empty={relevance:'POLITICAL_NEWS',actors:[],action:null,object:null,location:null,event_time:null,statements:[]};
 const x=validateMinimalExtraction(empty,input.content);assert.deepEqual(x.statements,[]);
 assert.throws(()=>requireCompleteExtraction(x),/INCOMPLETE_EXTRACTION/);
 const {statements,...missing}=empty;assert.equal(statements.length,0);
 assert.throws(()=>validateMinimalExtraction(missing,input.content),/AI_INVALID_SCHEMA/);
});
test('120B override uses strict minimal extraction then classification without publication metadata',async()=>{
 const [extraction]=minimalParts(sample.understanding);let calls=0;
 const grounded=validateMinimalExtraction(extraction,input.content);
 const classification={anchorIds:classificationReferences(grounded).requiredAnchorIds,factLabels:grounded.statements.map(f=>({id:f.id,kind:'FACT',material:false})),filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:['f1']};
 const provider=new GroqLanguageProvider('mock',async(_url,init)=>{
  const request=JSON.parse(String(init?.body)),data=JSON.parse(request.messages[1].content);
  assert.equal(request.model,'openai/gpt-oss-120b');assert.equal(request.response_format.json_schema.strict,true);
  assert.equal(request.response_format.json_schema.name,calls===0?'iran_today_extract':'iran_today_classify');
  assert.ok(!('publishedAt' in data));
  if(!calls){assert.ok(!JSON.stringify(request.response_format.json_schema.schema).includes('"start"'));assert.ok(!JSON.stringify(request.response_format.json_schema.schema).includes('summary'));}
  else {assert.deepEqual(data,idClassificationInput(grounded,official));assert.equal(data.classificationReferences.entries.find((e:{id:string})=>e.id==='f1')!.evidence.start,0);}
  return response(calls++===0?{...extraction,coverage:[{unitId:'u1',nonFactual:false,factIds:['f1']}],contentType:'NEWS',contentTypeEvidence:{excerpt:input.content,context:input.content}}:classification);
 },()=>{},'openai/gpt-oss-120b');
 const u=await provider.understand(input,new AbortController().signal);
 assert.equal(u.event.summary,null);assert.equal(u.event.eventTime,null);assert.equal(u.event.facts[0].id,'f1');assert.equal(u.event.facts[0].verified,false);assert.equal(calls,2);
});
test('invalid or incomplete extraction never reaches classification',async()=>{
 for(const mode of ['fabricated','empty'] as const){
  const values=minimalParts(sample.understanding);let calls=0;
  if(mode==='fabricated')values[0].actors[0].excerpt='invented nationality';else values[0].statements=[];
  const provider=new GroqLanguageProvider('mock',async()=>{calls++;return response({...values[0],contentType:'NEWS',contentTypeEvidence:{excerpt:input.content,context:input.content}});},()=>{});
  await assert.rejects(provider.understand(input,new AbortController().signal),/AI_SCHEMA_REPAIR_FAILED/);assert.equal(calls,2);
 }
});
test('classification cannot replace evidence, omit statements, change IDs, or infer absent anchors',()=>{
 const [raw,c]=minimalParts(sample.understanding),x=validateMinimalExtraction(raw,input.content);
 for(const mutate of [(v:typeof c)=>{v.factLabels=[];},(v:typeof c)=>{v.factLabels[0].id='invented';},(v:typeof c)=>{v.anchorIds=v.anchorIds.filter(id=>id!=='action');}]){
  const bad=structuredClone(c);mutate(bad);assert.throws(()=>adaptIdClassification(x,bad,input.content),/(?:INVALID_ID_CLASSIFICATION|CLASSIFICATION_EVIDENCE_MISMATCH)/);
 }
});
