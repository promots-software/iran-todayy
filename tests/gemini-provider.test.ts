import test from 'node:test';
import assert from 'node:assert/strict';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {fixture} from './fixtures/processing';
import {ruleSet} from '../src/lib/processing/rules';
import {unknownProfile} from '../src/lib/processing/contracts';

test('cached stage responses consume no new-request allowance or token/cost accounting',async()=>{
 const f=fixture('cached','قال المسؤول إن الاجتماع انتهى.','ar','قال المسؤول إن الاجتماع انتهى.');
 const provider=new GeminiLanguageProvider('offline',async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({titleAtomId:'cached:visit',bodyAtomIds:['cached:visit']})}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}},{headers:{'x-worker-checkpoint-replayed':'true'}}),u=>{assert.equal(u.estimatedCostUsd,0);assert.equal(u.inputTokens,0);assert.equal(u.replayed,true);});
 for(let i=0;i<10;i++)await provider.draft({content:f.content,understanding:f.understanding,rules:ruleSet},new AbortController().signal);
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
