import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {budgetDecision,costTelemetry,guardedTransport,geminiResource,providerCapacitySnapshot} from '../src/worker/provider-guard';
import {costConfig,transientBackoff} from '../src/worker/cost-config';
import {failurePolicy,isProviderWait} from '../src/lib/processing/failure-policy';
import {editorialDecision} from '../src/lib/processing/editorial-eligibility';
import {ingest} from '../src/lib/processing/engine';
test('config fails closed; warning does not reject safe reservations',()=>{
 assert.deepEqual(costConfig({}),{hard:2,warning:1.5,retries:2});
 for(const env of [{GEMINI_COST_HARD_LIMIT_USD_24H:'NaN'},{GEMINI_COST_HARD_LIMIT_USD_24H:'0'},{GEMINI_MAX_TRANSIENT_RETRIES:'3'},{GEMINI_COST_WARNING_USD_24H:'3'}])assert.throws(()=>costConfig(env));
 const now=Date.now();
 assert(budgetDecision([{at:now,usd:1.49}],100,now).allowed);
 assert(budgetDecision([{at:now,usd:1.50}],100,now).allowed);
 assert.equal(budgetDecision([{at:now,usd:1.999}],100,now).reason,'PROVIDER_COST_WAIT');
 const rows=[{id:'r',action:'PROVIDER_RESERVED',createdAt:new Date(now),metadata:{usd:1.51}}];
 assert.equal(costTelemetry(rows,now).warning,true);assert.equal(costTelemetry(rows,now).circuit,'CLOSED');
 assert.equal(costTelemetry(rows,now).outstandingReservedUsd,1.51);
 rows.push({id:'s',action:'PROVIDER_USAGE_SETTLED',createdAt:new Date(now),metadata:{usd:1.49,reservationId:'r'} as {usd:number}});
 assert.equal(costTelemetry(rows,now).accountedUsd,1.49);assert.equal(costTelemetry(rows,now).outstandingReservedUsd,0);
 assert.equal(costTelemetry(rows,now+86400001).accountedUsd,0);
});
test('bounded jitter respects provider wait and exhaustion stays technical',()=>{
 assert.equal(transientBackoff(1,0,()=>0),24000);assert.equal(transientBackoff(2,0,()=>1),72000);
 assert.equal(transientBackoff(2,300000,()=>0),300000);
 for(const code of ['PROVIDER_TRANSIENT_WAIT','PROVIDER_RETRY_EXHAUSTED']){assert(isProviderWait(code));assert(failurePolicy(code,99).safeCheckpointRetry);assert.equal(editorialDecision({error:code},{autoPublish:false,shadowMode:true,requireApproval:true}).editorialEligibility,'PROCESSING_ERROR');}
 assert.equal(failurePolicy('GEMINI_TRANSPORT_FAILED',1).safeCheckpointRetry,false);
 assert.equal(failurePolicy('PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW',1).safeCheckpointRetry,false);
 assert.equal(editorialDecision({error:'PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW'},{autoPublish:false,shadowMode:true,requireApproval:true}).editorialEligibility,'PROCESSING_ERROR');
});
const local={skip:!process.env.TEST_DATABASE_URL};
function db(){assert.equal(new URL(process.env.TEST_DATABASE_URL!).hostname,'127.0.0.1');return new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});}
const request={method:'POST',body:JSON.stringify({generationConfig:{maxOutputTokens:1024},contents:[]})};
const url='https://'+geminiResource;
const ok=()=>Response.json({usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}});
test('concurrent reservations cannot cross $2; collection remains durable',local,async()=>{
 const d=db();let calls=0;
 try{
 await d.auditLog.create({data:{action:'PROVIDER_RESERVED',entityType:'ProviderBudget',entityId:'gemini',message:'offline',metadata:{usd:1.998,bytes:1,inputTokens:1}}});
 const results=await Promise.allSettled(['a','b'].map(p=>guardedTransport(d,p,async()=>{calls++;return Response.json({});})(url,request)));
 assert.equal(calls,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const state=await providerCapacitySnapshot(d);assert(state.cost.accountedUsd<=2);
 const s=await d.source.create({data:{platform:'TELEGRAM',name:'offline',handle:randomUUID(),url:'https://t.me/offline'}});
 const p=await ingest(d,s.id,{externalId:'1',url:s.url+'/1',content:'أعلنت الوزارة افتتاح مشروع جديد',publishedAt:new Date()});
 assert.equal(await d.processingJob.count({where:{sourcePostId:p.id}}),1);assert.equal(await d.publication.count(),0);
 }finally{await d.auditLog.deleteMany({where:{entityType:'ProviderBudget'}});await d.$disconnect();}
});
test('503 operation allows exactly initial plus two retries, then zero calls; retries obey budget',local,async()=>{
 const d=db();let calls=0;
 try{
 for(let i=0;i<3;i++){
 await assert.rejects(guardedTransport(d,'retry',async()=>{calls++;return Response.json({error:{status:'UNAVAILABLE'}},{status:503});})(url,request),i===2?/PROVIDER_RETRY_EXHAUSTED/:/PROVIDER_TRANSIENT_WAIT/);
 await d.auditLog.deleteMany({where:{action:{in:['PROVIDER_CAPACITY_BLOCKED','PROVIDER_CAPACITY_PROBE']}}});
 if(i===0){
 const hold=await d.auditLog.create({data:{action:'PROVIDER_RESERVED',entityType:'ProviderBudget',entityId:'gemini',message:'offline budget',metadata:{usd:2,inputTokens:1}}});
 await assert.rejects(guardedTransport(d,'retry',async()=>{calls++;return ok();})(url,request),/PROVIDER_COST_WAIT/);assert.equal(calls,1);await d.auditLog.delete({where:{id:hold.id}});
 }
 }
 await assert.rejects(guardedTransport(d,'retry',async()=>{calls++;return ok();})(url,request),/PROVIDER_RETRY_EXHAUSTED/);assert.equal(calls,3);
 }finally{await d.auditLog.deleteMany({where:{entityType:'ProviderBudget'}});await d.$disconnect();}
});
test('duplicate worker operation executes once and successful checkpoint replays without charge',local,async()=>{
 const d=db();let calls=0;
 try{
 const run=()=>guardedTransport(d,'race',async()=>{calls++;await new Promise(r=>setTimeout(r,30));return ok();})(url,request);
 await Promise.allSettled([run(),run()]);assert.equal(calls,1);await run();assert.equal(calls,1);
 assert.equal(await d.auditLog.count({where:{action:'PROVIDER_RESERVED',entityType:'ProviderBudget'}}),1);
 }finally{await d.$disconnect();}
});
