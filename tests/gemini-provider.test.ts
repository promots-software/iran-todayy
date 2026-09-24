import test from 'node:test';
import assert from 'node:assert/strict';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {fixture} from './fixtures/processing';
import {ruleSet} from '../src/lib/processing/rules';
import {unknownProfile} from '../src/lib/processing/contracts';

test('cached stage responses consume no new-request allowance or token/cost accounting',async()=>{
 const f=fixture('cached','قال المسؤول إن الاجتماع انتهى.','ar','قال المسؤول إن الاجتماع انتهى.');
 const provider=new GeminiLanguageProvider('offline',async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({relation:'SAME',newFactIds:[],conflictingFactIds:[],rationale:'نفس الحدث',identity:{basis:'SAME_OCCURRENCE',incomingFactIds:['cached:visit'],existingFactIds:['cached:visit'],explanation:'Offline exact event'}})}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}},{headers:{'x-worker-checkpoint-replayed':'true'}}),u=>{assert.equal(u.estimatedCostUsd,0);assert.equal(u.inputTokens,0);assert.equal(u.replayed,true);});
 for(let i=0;i<10;i++)await provider.compare({incoming:f.understanding.event,existing:f.understanding.event},new AbortController().signal);
});
test('Gemini extraction uses fixed model, no thinking and leaves 503 retry to durable queue',async()=>{
 const f=fixture('gemini-offline','قال المسؤول إن الاجتماع انتهى.','ar','قال المسؤول إن الاجتماع انتهى.');let calls=0;
 const provider=new GeminiLanguageProvider('offline',async(url,init)=>{
  calls++;assert.ok(String(url).includes('gemini-3.1-flash-lite'));const req=JSON.parse(String(init?.body));assert.equal(req.generationConfig.thinkingConfig.thinkingBudget,0);
  assert.ok('statements' in req.generationConfig.responseJsonSchema.properties);
  if(calls===1)return Response.json({error:{status:'UNAVAILABLE'}},{status:503});
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({titleAtomId:'gemini-offline:visit',bodyAtomIds:['gemini-offline:visit']})}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}});
 });
 await assert.rejects(provider.understand({content:f.content,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal),/GEMINI_HTTP_503/);assert.equal(calls,1);
});
test('Gemini transport timeout is counted and never retried',async()=>{
 const f=fixture('timeout','قال إن الاجتماع انتهى.');let calls=0,records=0;
 const provider=new GeminiLanguageProvider('offline',async()=>{calls++;throw new Error('timeout');},u=>{records++;assert.equal(u.httpStatus,null);});
 await assert.rejects(provider.understand({content:f.content,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal),/GEMINI_TRANSPORT_FAILED/);
 assert.equal(calls,1);assert.equal(records,1);
});

test('invalid provider schema preserves only safe stage and field diagnostics',async()=>{
 const source='افتتح المجلس مدرسة جديدة.';let calls=0;
 const provider=new GeminiLanguageProvider('offline',async()=>{
  calls++;
  const output=calls===1?{contentType:'NEWS',contentTypeEvidence:{excerpt:source,context:source},relevance:'POLITICAL_NEWS',coverage:[{unitId:'u1',factIds:['f1'],nonFactual:false}],actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:source,context:source},speaker:null}]}:{anchorIds:[],factLabels:[{id:'f1',kind:'FACT',material:true}],filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P3',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:[]};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}});
 });
 await assert.rejects(provider.understand({content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal),(error:unknown)=>{
  assert(error instanceof Error);const failure=error as Error&{code:string;diagnostic:{stage:string;issues:{code:string;path:(string|number)[]}[]}};
  assert.equal(failure.code,'AI_INVALID_SCHEMA');assert(failure.diagnostic.stage.includes('classif'));assert(failure.diagnostic.issues.some(i=>i.code==='too_small'&&i.path.join('.')==='rationaleIds'));assert(!JSON.stringify(failure.diagnostic).includes(source));assert.deepEqual((failure.diagnostic as {output?:{rationaleIds:string[]}}).output?.rationaleIds,[]);return true;
 });assert.equal(calls,2);
});
