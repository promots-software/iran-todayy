import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {compactGeminiRequest,checkpointAliases,type GeminiRequest,type CheckpointRequestInit} from '../src/lib/processing/gemini-request';
import {coverageInstructions} from '../src/lib/processing/editorial-scope';
import {guardedTransport,geminiResource,budgetDecision,limits} from '../src/worker/provider-guard';
import {databaseCheckpoints} from '../src/worker/checkpoints';
import {quotaDecision,googleQuota} from '../src/worker/provider-quota';

function request(count=1):GeminiRequest{
 const schema={type:'object',properties:{topic:{enum:['UNKNOWN','IRAN_DOMESTIC']}},required:['topic'],additionalProperties:false};
 return {systemInstruction:{parts:[{text:'Preserve exact evidence, attribution, quotes, scope and review. Return the complete structured object matching this schema: '+JSON.stringify(schema)+'\n'+coverageInstructions+'\nCOVERAGE POLICY OVERRIDE:\n'+coverageInstructions}]},contents:[{role:'user',parts:[{text:JSON.stringify({classificationReferences:{requiredAnchorIds:['actor:1'],requiredFactIds:Array.from({length:count},(_,i)=>'f'+i)}})}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:4096,candidateCount:1,thinkingConfig:{thinkingBudget:0}}};
}
test('compact prompt removes exact duplicates only, preserving schema/input and operative instructions',()=>{
 const before=request(),copy=structuredClone(before),after=compactGeminiRequest(before,'iran_today_extract');
 assert.deepEqual(before,copy);assert.deepEqual(after.contents,before.contents);assert.deepEqual(after.generationConfig,before.generationConfig);
 const expected=before.systemInstruction.parts[0].text.replace('Return the complete structured object matching this schema: '+JSON.stringify(before.generationConfig.responseJsonSchema),'Return the complete structured object matching the supplied response schema.').slice(0,-('\nCOVERAGE POLICY OVERRIDE:\n'+coverageInstructions).length);
 assert.equal(after.systemInstruction.parts[0].text,expected);
 const single=request();single.systemInstruction.parts[0].text='Other instructions\nCOVERAGE POLICY OVERRIDE:\n'+coverageInstructions;
 assert.equal(compactGeminiRequest(single,'iran_today_compare').systemInstruction.parts[0].text,single.systemInstruction.parts[0].text);
 const different=request();different.systemInstruction.parts[0].text='Return the complete structured object matching this schema: {"different":true}';
 assert.equal(compactGeminiRequest(different,'iran_today_extract').systemInstruction.parts[0].text,different.systemInstruction.parts[0].text);
});
test('only ID-only output budget scales; large/unknown contracts retain room and prose stages unchanged',()=>{
 const small=compactGeminiRequest(request(),'iran_today_classify');assert.equal(small.generationConfig.maxOutputTokens,1024);
 const large=compactGeminiRequest(request(100),'iran_today_classify');assert.equal(large.generationConfig.maxOutputTokens,4096);
 for(const stage of ['iran_today_extract','iran_today_render','iran_today_render_review','iran_today_compare'])assert.equal(compactGeminiRequest(request(),stage).generationConfig.maxOutputTokens,4096);
 const malformed=request();malformed.contents[0].parts[0].text='{}';assert.equal(compactGeminiRequest(malformed,'iran_today_classify').generationConfig.maxOutputTokens,4096);
});
test('45/hour is superseded, but RPM/TPM/RPD and the dollar ceiling still fail closed',()=>{
 const now=Date.parse('2026-09-21T15:00:00Z');const rows=Array.from({length:60},()=>({at:now-60001,usd:.001,inputTokens:100}));
 assert.equal(limits.hourRequests,null);assert.equal(budgetDecision(rows,1000,now,1024).allowed,true);assert.equal(quotaDecision(rows,1000,now).reason,null);
 assert.equal(quotaDecision(Array.from({length:googleQuota.rpm},()=>({at:now,inputTokens:1})),1,now).reason,'PROVIDER_RPM_WAIT');
 assert.equal(quotaDecision([{at:now,inputTokens:googleQuota.inputTpm}],1,now).reason,'PROVIDER_TPM_WAIT');
 assert.equal(quotaDecision(Array.from({length:googleQuota.rpd},()=>({at:now-60001,inputTokens:1})),1,now).reason,'PROVIDER_RPD_WAIT');
 assert.equal(budgetDecision([{at:now,usd:3}],1,now,1024).reason,'PROVIDER_COST_WAIT');
});
test('legacy completed request reuses output during outage; ambiguous legacy request is never resent',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));const db=new PrismaClient({datasourceUrl:url});
 const endpoint='https://'+geminiResource,old=JSON.stringify(request()),body=JSON.stringify(compactGeminiRequest(request(),'iran_today_classify'));
 const key=createHash('sha256').update(`native-gemini-request-v1:${endpoint}:${old}`).digest('hex');let calls=0;
 const init:CheckpointRequestInit={method:'POST',body,[checkpointAliases]:[old]};const good=randomUUID(),pending=randomUUID();
 try{
  const output={candidates:[],usageMetadata:{promptTokenCount:12,candidatesTokenCount:2,totalTokenCount:14}};
  await databaseCheckpoints(db,good).finish(key,output);await databaseCheckpoints(db,pending).start(key);
  await db.auditLog.create({data:{action:'PROVIDER_CAPACITY_BLOCKED',entityType:'ProviderBudget',entityId:'gemini',message:'Offline test',metadata:{resource:geminiResource,until:Date.now()+600000}}});
  const transport:typeof fetch=async()=>{calls++;throw Error('MUST_NOT_CALL');};
  const result=await guardedTransport(db,good,transport)(endpoint,init);assert.deepEqual(await result.json(),output);assert.equal(result.headers.get('x-worker-checkpoint-replayed'),'true');
  await assert.rejects(guardedTransport(db,pending,transport)(endpoint,init),/OUTCOME_REQUIRES_REVIEW/);assert.equal(calls,0);assert.equal(await db.auditLog.count({where:{action:'PROVIDER_RESERVED'}}),0);
  await db.auditLog.deleteMany({where:{action:'PROVIDER_CAPACITY_BLOCKED'}});
  await guardedTransport(db,randomUUID(),async(_url,options)=>{calls++;assert.equal(Object.getOwnPropertySymbols(options??{}).length,0);return Response.json(output);})(endpoint,init);assert.equal(calls,1);
 }finally{await db.$disconnect();}
});
