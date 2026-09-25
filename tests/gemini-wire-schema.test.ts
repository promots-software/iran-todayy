import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {geminiWireSchema} from '../src/lib/processing/gemini-wire-schema';
import {groqSchema} from '../src/lib/processing/groq-context';
import {normalExtractionSchema} from '../src/lib/processing/normal-v2';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {unknownProfile} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
test('Gemini projection retains local cardinality and all other schema fields',()=>{
 const local=z.object({rows:z.array(z.string()).min(1).max(2)}).strict();const wire=groqSchema('understand',local);const before=structuredClone(wire);const projected=geminiWireSchema(wire) as {properties:{rows:Record<string,unknown>}};
 assert.equal(projected.properties.rows.minItems,undefined);assert.equal(projected.properties.rows.maxItems,undefined);assert.deepEqual(wire,before);
 assert.equal(local.safeParse({rows:[]}).success,false);assert.equal(local.safeParse({rows:['a','b','c']}).success,false);assert.equal(local.safeParse({rows:['a']}).success,true);
 assert.equal(normalExtractionSchema.shape.coverage.safeParse([]).success,false);assert.equal(normalExtractionSchema.shape.actors.safeParse(Array(31).fill({excerpt:'a',context:'a'})).success,false);
});
test('actual Gemini boundary omits bounds and rejects returned empty required coverage locally',async()=>{
 let calls=0;const p=new GeminiLanguageProvider('offline',async(_u,init)=>{calls++;const request=JSON.parse(String(init?.body));assert(!JSON.stringify(request.generationConfig.responseJsonSchema).includes('maxItems'));assert(!JSON.stringify(request.generationConfig.responseJsonSchema).includes('minItems'));
 return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({relevance:'POLITICAL_NEWS',actors:[],action:null,object:null,location:null,event_time:null,statements:[],coverage:[],contentType:'NEWS',contentTypeEvidence:{excerpt:'a',context:'a'}})}]}}]});});
 await assert.rejects(p.understand({content:'أقر البرلمان الإيراني قانوناً جديداً.',publishedAt:new Date(),profile:unknownProfile,rules:ruleSet,processingMode:'NORMAL'},new AbortController().signal));assert(calls>=1&&calls<=2);
});
