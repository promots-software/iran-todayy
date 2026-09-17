import test from 'node:test';
import assert from 'node:assert/strict';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {fixture} from './fixtures/processing';
import {ruleSet} from '../src/lib/processing/rules';
test('Gemini atom selection uses fixed model, no thinking and only one 503 retry',async()=>{
 const f=fixture('gemini-offline','قال المسؤول إن الاجتماع انتهى.','ar','قال المسؤول إن الاجتماع انتهى.');let calls=0;
 const provider=new GeminiLanguageProvider('offline',async(url,init)=>{
  calls++;assert.ok(String(url).includes('gemini-3.1-flash-lite'));const req=JSON.parse(String(init?.body));assert.equal(req.generationConfig.thinkingConfig.thinkingBudget,0);
  assert.deepEqual(Object.keys(req.generationConfig.responseJsonSchema.properties),['titleAtomId','bodyAtomIds']);
  if(calls===1)return Response.json({error:{status:'UNAVAILABLE'}},{status:503});
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({titleAtomId:'gemini-offline:visit',bodyAtomIds:['gemini-offline:visit']})}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}});
 });
 const result=await provider.draft({content:f.content,understanding:f.understanding,rules:ruleSet},new AbortController().signal) as {title:string};assert.ok(result.title);assert.equal(calls,2);
});
test('Gemini transport timeout is counted and never retried',async()=>{
 const f=fixture('timeout','قال إن الاجتماع انتهى.');let calls=0,records=0;
 const provider=new GeminiLanguageProvider('offline',async()=>{calls++;throw new Error('timeout');},u=>{records++;assert.equal(u.httpStatus,null);});
 await assert.rejects(provider.draft({content:f.content,understanding:f.understanding,rules:ruleSet},new AbortController().signal),/GEMINI_TRANSPORT_FAILED/);
 assert.equal(calls,1);assert.equal(records,1);
});
