import test from 'node:test';
import assert from 'node:assert/strict';
import frozen from './fixtures/staging-hardening/frozen-13.json';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {ProcessingError,unknownProfile,type Understanding} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {editorialContract} from '../src/lib/processing/editorial-contract';
process.env.SHADOW_MODE='true';process.env.AUTO_PUBLISH='false';process.env.TELEGRAM_PUBLISH_ENABLED='false';
for(const item of frozen)test(`frozen staging ${item.source}/${item.externalId}: no invented downstream output`,async()=>{
 let used=0;const provider=new GeminiLanguageProvider('offline-only',async(_url,init)=>{
  const body=JSON.parse(String(init?.body));if(body.generationConfig.responseJsonSchema.properties.article||body.generationConfig.responseJsonSchema.properties.publication)assert.equal(body.systemInstruction.parts[0].text.split(editorialContract).length,2);
  const next=item.outputs[used++];if(!next)throw new ProcessingError('OFFLINE_NEXT_STAGE_REQUIRED');
  return Response.json({candidates:[{finishReason:next.finishReason,content:{parts:[{text:JSON.stringify(next.output)}]}}],usageMetadata:{promptTokenCount:0,candidatesTokenCount:0,thoughtsTokenCount:0}});
 });
 const signal=new AbortController().signal;let terminal='UNEXPECTED_PASS';let diagnostic:unknown;
 try{
  if(!item.normalized.trim())throw new ProcessingError('SOURCE_TEXT_REQUIRED');
  const understanding=await provider.understand({content:item.normalized,publishedAt:new Date('2026-09-25T18:00:00Z'),processingMode:item.mode as 'NORMAL'|'DIRECT',profile:unknownProfile,rules:ruleSet},signal) as Understanding;
  await provider.draft({content:item.normalized,understanding,rules:ruleSet,processingMode:item.mode as 'NORMAL'|'DIRECT'},signal);
 }catch(e){assert(e instanceof ProcessingError);terminal=e.code;diagnostic=e.diagnostic;}
 assert.notEqual(terminal,'UNEXPECTED_PASS');assert(used<=item.outputs.length+1);
 console.log(JSON.stringify({frozenReplay:item.externalId,old:item.terminal,new:terminal,storedResponsesUsed:Math.min(used,item.outputs.length),diagnostic:diagnostic&&typeof diagnostic==='object'&&'issues'in diagnostic?diagnostic.issues:undefined}));
});
