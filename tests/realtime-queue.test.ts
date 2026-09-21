import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {capacityDiagnostic,capacityState,capacityRetryMs} from '../src/worker/provider-capacity';
import {googleQuota,pacificDay,quotaDecision} from '../src/worker/provider-quota';
import {budgetDecision,guardedTransport,geminiResource,providerCapacitySnapshot} from '../src/worker/provider-guard';
import {failurePolicy} from '../src/lib/processing/failure-policy';
import {distribution,latencyAlerts} from '../src/worker/latency';
import {checkpointProvider,databaseCheckpoints} from '../src/worker/checkpoints';
import {processingLanes} from '../src/worker/newsroom-scheduler';
import {ingest,claimJob,processJob,json} from '../src/lib/processing/engine';
import {type LanguageProvider} from '../src/lib/processing/contracts';
import {fixtureProvider,scenarios,official} from './fixtures/processing';
import {ruleSet} from '../src/lib/processing/rules';

test('Pacific quota days reset at calendar midnight, including 23/25-hour DST days',()=>{
 for(const [date,hours] of [['2026-03-08T18:00:00Z',23],['2026-11-01T18:00:00Z',25],['2026-09-20T18:00:00Z',24]] as const){const d=pacificDay(Date.parse(date));assert.equal(d.end-d.start,hours*3600000);assert.equal(pacificDay(d.end).start,d.end);}
 const now=Date.parse('2026-09-20T07:00:00Z');assert.equal(pacificDay(now).start,now);
 const boundary=quotaDecision(Array.from({length:googleQuota.rpd},()=>({at:now-1,inputTokens:0})),1,now);assert.equal(boundary.rpd,0,'previous Pacific day does not consume RPD');assert.equal(boundary.reason,'PROVIDER_RPM_WAIT','minute quota does not reset at midnight');
});
test('RPM and TPM reserve atomically before an uncached request; exact boundaries release capacity',()=>{
 const now=Date.parse('2026-09-20T20:00:00Z');
 const rpm=Array.from({length:googleQuota.rpm},()=>({at:now-100,inputTokens:10}));assert.equal(quotaDecision(rpm,10,now).reason,'PROVIDER_RPM_WAIT');assert.equal(quotaDecision(rpm,10,now+59900).reason,null);
 assert.equal(quotaDecision([{at:now,inputTokens:googleQuota.inputTpm-1}],2,now).reason,'PROVIDER_TPM_WAIT');
 assert.equal(quotaDecision([],googleQuota.inputTpm+1,now).reason,'PROVIDER_INPUT_LIMIT');
 const rpd=Array.from({length:googleQuota.rpd},()=>({at:now-60001,inputTokens:1}));assert.equal(quotaDecision(rpd,1,now).reason,'PROVIDER_RPD_WAIT');assert.equal(quotaDecision(rpd,1,now).waitMs,pacificDay(now).end-now);
});
test('actual-request cost reserve and $2 rolling-24-hour ceiling; no maximum-call preclaim reserve',()=>{
 const now=Date.now();assert.equal(budgetDecision([{at:now,usd:1}],100,now,1024).allowed,true);assert.equal(budgetDecision([],100,now,1024).reservedUsd,(100*.25+1024*1.5)/1e6);
 assert.equal(budgetDecision([{at:now,usd:1.99}],100,now,1024).allowed,true);
 assert.equal(budgetDecision([{at:now,usd:3}],100,now,1024).reason,'PROVIDER_COST_WAIT');
 assert.equal(budgetDecision([],100,now,4097).reason,'PROVIDER_INPUT_LIMIT');
});
test('sanitized quota diagnostics preserve RetryInfo but never message, project, key or payload',()=>{
 const secret='private-value-do-not-retain';const d=capacityDiagnostic(429,{error:{status:'RESOURCE_EXHAUSTED',message:secret,details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'2.5s'},{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[null,{quotaId:'GenerateRequestsPerDayPerProjectPerModel',quotaValue:'500',quotaDimensions:{project:secret}}]}]}},120000);
 assert.equal(d.retryMs,120000);assert.deepEqual(d.quotas,[{period:'DAY',unit:'REQUESTS',limit:500}]);assert(!JSON.stringify(d).includes(secret));assert.equal(capacityRetryMs(d),120000);
 assert.equal(capacityDiagnostic(503,{error:{details:[null]}}).status,'UNKNOWN');
});
test('recorded five-failure incident cannot create the old 32-minute claim gate',()=>{
 const now=Date.now();const old=Array.from({length:5},(_,i)=>({action:'PROVIDER_COOLDOWN',createdAt:new Date(now-(i+1)*60000),metadata:{until:now+32*60000}}));
 assert.equal(60000*2**old.length,1920000);
 assert.deepEqual(capacityState(old,geminiResource,now),{waitMs:0,probe:false});
 const blocked={action:'PROVIDER_CAPACITY_BLOCKED',createdAt:new Date(now),metadata:{resource:geminiResource,until:now+120000}};
 assert.equal(capacityState([...old,blocked],'other-model',now).waitMs,0);
 assert.equal(capacityState([...old,blocked],geminiResource,now).waitMs,120000);
});
test('one recovery probe lease; stale in-flight success cannot reopen a newer failed resource',()=>{
 const now=Date.now();const rows=[{action:'PROVIDER_CAPACITY_BLOCKED',createdAt:new Date(now),metadata:{resource:geminiResource,until:now+1000}}];
 assert.equal(capacityState(rows,geminiResource,now+1000).probe,true);
 const probe={action:'PROVIDER_CAPACITY_PROBE',createdAt:new Date(now+1000),metadata:{resource:geminiResource,until:now+66000}};
 assert.equal(capacityState([...rows,probe],geminiResource,now+1001).waitMs,64999);
 const stale={action:'PROVIDER_CAPACITY_HEALTHY',createdAt:new Date(now+1002),metadata:{resource:geminiResource,requestStartedAt:now-1}};
 assert(capacityState([...rows,probe,stale],geminiResource,now+1003).waitMs>0);
 const success={...stale,metadata:{resource:geminiResource,requestStartedAt:now+1000}};assert.equal(capacityState([...rows,probe,success],geminiResource,now+1003).waitMs,0);
});
test('capacity deferrals safely resume; ambiguous network outcomes remain fail-closed',()=>{
 for(const code of ['PROVIDER_RPM_WAIT','PROVIDER_TPM_WAIT','PROVIDER_RPD_WAIT','PROVIDER_COST_WAIT','PROVIDER_HOURLY_WAIT','PROVIDER_CAPACITY_WAIT']){assert(failurePolicy(code,1).safeCheckpointRetry);assert(failurePolicy(code,1).retryable);}
 assert.equal(failurePolicy('GEMINI_TRANSPORT_FAILED',1).safeCheckpointRetry,false);
 assert.equal(failurePolicy('UNSUPPORTED_OUTPUT',1).retryable,false);
});
test('SLO alerts retain missing measurements and enforce agreed thresholds',()=>{
 assert.deepEqual(distribution([]),{count:0,p50Ms:null,p95Ms:null,maxMs:null});
 assert.deepEqual(latencyAlerts({ingestMs:60001,oldestEligibleMs:15001,oldestRunningMs:120001,readyMs:180001}),['INGEST_LATENCY','QUEUE_LATENCY','PROCESSING_LATENCY','REVIEW_LATENCY']);
});

const dbTest={skip:!process.env.TEST_DATABASE_URL};
function localDb(){const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');return new PrismaClient({datasourceUrl:url});}
const request={method:'POST',body:JSON.stringify({generationConfig:{maxOutputTokens:1024},contents:[]})};
const endpoint='https://'+geminiResource;
const ok=()=>Response.json({usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20},candidates:[]});

test('DB claim respects future UTC retry times in a non-UTC database session',dbTest,async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');url.searchParams.set('connection_limit','1');
 const db=new PrismaClient({datasourceUrl:url.toString()});
 try{
  await db.$executeRawUnsafe("SET TIME ZONE 'Asia/Beirut'");
  const excluded=(await db.sourcePost.findMany({select:{id:true}})).map(p=>p.id);
  const source=await db.source.create({data:{name:'Offline UTC fixture',handle:randomUUID(),platform:'TELEGRAM',url:'https://t.me/offline'}});
  const post=await ingest(db,source.id,{externalId:'future',url:'https://t.me/offline/future',content:'زلزال في فرنسا',publishedAt:new Date(),metadata:{}});
  const now=new Date(),due=new Date(now.getTime()+120000);
  await db.processingJob.update({where:{sourcePostId_stage:{sourcePostId:post.id,stage:'PROCESS_V1'}},data:{availableAt:due}});
  assert.equal(await claimJob(db,'utc-before',now,true,excluded),null);
  const claimed=await claimJob(db,'utc-due',due,true,excluded);assert.equal(claimed?.sourcePostId,post.id);
  assert.equal(await claimJob(db,'utc-twice',due,true,excluded),null);
  await db.processingJob.update({where:{id:claimed!.id},data:{status:'COMPLETED',lockedBy:null,lockedAt:null}});
 }finally{await db.$disconnect();}
});
test('DB incident: 429 waits durably; ingestion/local/cached work and both lanes continue; one probe after restart',dbTest,async()=>{
 const db=localDb();let calls=0;
 try{
  const source=await db.source.create({data:{name:'Offline capacity fixture',handle:randomUUID(),platform:'TELEGRAM',url:'https://t.me/offline',editorialProfile:json(official)}});
  const f=scenarios[0],add=(id:string,content:string)=>ingest(db,source.id,{externalId:id,url:'https://t.me/offline/'+id,content,publishedAt:new Date(),metadata:{}});
  const blocked=await add('blocked',f.content);const cached=await add('cached',scenarios[1].content);
  const cache=checkpointProvider(fixtureProvider(),databaseCheckpoints(db,cached.id));
  await cache.understand({content:scenarios[1].content,publishedAt:cached.sourcePublishedAt,profile:official,rules:ruleSet},new AbortController().signal);
  for(let i=0;i<5;i++)await db.auditLog.create({data:{action:'PROVIDER_COOLDOWN',entityType:'ProviderBudget',entityId:'gemini',message:'Offline incident fixture',createdAt:new Date(Date.now()-(i+1)*60000),metadata:{until:Date.now()+1920000}}});
  const failing:LanguageProvider={id:'offline-capacity',live:false,understand:async()=>{await guardedTransport(db,blocked.id,async()=>{calls++;return Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status:429,headers:{'retry-after':'120'}});})(endpoint,request);throw Error('unreachable');},compare:async()=>null,draft:async()=>null};
  const job=await claimJob(db,'offline',new Date(),true,[cached.id],true);assert(job);assert.equal(job.sourcePostId,blocked.id);
  await processJob(db,job,failing,new AbortController().signal);
  const held=await db.processingJob.findUniqueOrThrow({where:{id:job.id}});assert.equal(held.status,'RETRY');assert.equal(held.lockedBy,null);assert(held.availableAt.getTime()>Date.now()+110000);assert.equal(held.attemptCount,0);
  assert.equal((await providerCapacitySnapshot(db)).state,'CAPACITY_WAIT');
  const outside=await add('new-during-wait','زلزال في فرنسا');assert.equal(await db.processingJob.count({where:{sourcePostId:outside.id}}),1);
  const seen:string[]=[];
  await Promise.all(processingLanes(async lane=>{const next=await claimJob(db,'lane-'+lane,new Date(),true,[],true);assert(next);seen.push(next.sourcePostId);await processJob(db,next,next.sourcePostId===cached.id?cache:failing,new AbortController().signal);}));
  assert(seen.includes(cached.id)&&seen.includes(outside.id));assert.equal(calls,1);assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:outside.id}})).status,'FILTERED');
  assert.equal(await db.processingJob.count({where:{status:'RUNNING'}}),0);
  assert.equal((await db.processingJob.findUniqueOrThrow({where:{sourcePostId_stage:{sourcePostId:cached.id,stage:'PROCESS_V1'}}})).status,'COMPLETED');
  // A new adapter is a worker restart; the persisted request wait still holds.
  await assert.rejects(guardedTransport(db,blocked.id,async()=>{calls++;return ok();})(endpoint,request),/PROVIDER_CAPACITY_WAIT/);assert.equal(calls,1);
  await db.auditLog.create({data:{action:'PROVIDER_CAPACITY_BLOCKED',entityType:'ProviderBudget',entityId:'gemini',message:'Offline expiry fixture',metadata:{resource:geminiResource,until:Date.now()-1}}});
  let release!:()=>void;let entered!:()=>void;const enteredPromise=new Promise<void>(r=>{entered=r;});const response=new Promise<void>(r=>{release=r;});
  const probe=guardedTransport(db,randomUUID(),async()=>{calls++;entered();await response;return ok();})(endpoint,request);await enteredPromise;
  await assert.rejects(guardedTransport(db,randomUUID(),async()=>{calls++;return ok();})(endpoint,request),/PROVIDER_CAPACITY_WAIT/);
  release();await probe;assert.equal(calls,2);assert.equal((await providerCapacitySnapshot(db)).state,'AVAILABLE');
  const ambiguous=randomUUID();await assert.rejects(guardedTransport(db,ambiguous,async()=>{calls++;throw Error('offline transport');})(endpoint,request),/GEMINI_TRANSPORT_FAILED/);
  await assert.rejects(guardedTransport(db,ambiguous,async()=>{calls++;return ok();})(endpoint,request),/OUTCOME_REQUIRES_REVIEW/);assert.equal(calls,3);
  assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});
test('DB matching: network comparison holds no event lock; changed snapshot replans without duplicate event',dbTest,async()=>{
 const db=localDb();const signal=new AbortController().signal;
 try{
  const exclude=(await db.sourcePost.findMany({select:{id:true}})).map(p=>p.id);
  const source=await db.source.create({data:{name:'Offline race fixture',handle:randomUUID(),platform:'TELEGRAM',url:'https://t.me/offline',editorialProfile:json(official)}});
  const f=scenarios[2];const post=await ingest(db,source.id,{externalId:'race',url:'https://t.me/offline/race',content:f.content,publishedAt:new Date(),metadata:{}});
  const base=fixtureProvider();let comparisons=0,changed=false;
  const provider:LanguageProvider={id:base.id,live:false,understand:base.understand.bind(base),draft:base.draft.bind(base),compare:async(input)=>{
   comparisons++;await db.$transaction(async tx=>{const rows=await tx.$queryRaw<{free:boolean}[]>`SELECT pg_try_advisory_xact_lock(20916001) as free`;assert.equal(rows[0].free,true,'no AI request under shared event lock');
    if(!changed){changed=true;const e=await tx.canonicalEvent.findFirstOrThrow();const revision=await tx.eventRevision.findFirstOrThrow({where:{eventId:e.id},orderBy:{revision:'desc'}});await tx.eventRevision.create({data:{eventId:e.id,revision:revision.revision+1,facts:revision.facts!}});}
   });return base.compare(input);
  }};
  const before=await db.canonicalEvent.count();const job=await claimJob(db,'race',new Date(),true,exclude,true);assert(job);assert.equal(job.sourcePostId,post.id);
  const result=await processJob(db,job,provider,signal);assert(!('error' in result),JSON.stringify(result));assert(comparisons>=2);assert.equal(await db.canonicalEvent.count(),before);assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:post.id}})).status,'DUPLICATE');
  const audit=await db.auditLog.findFirstOrThrow({where:{entityId:post.id,action:'PROCESSING_DECISION_COMMITTED'}});const stored=await db.sourcePost.findUniqueOrThrow({where:{id:post.id}});assert.equal(stored.processingEndedAt!.toISOString(),(audit.metadata as {committedObservedAt:string}).committedObservedAt);
 }finally{await db.$disconnect();}
});

test('paid Tier 1 capacity admits the old 500-request boundary without changing cost limits',()=>{
 assert.deepEqual(googleQuota,{rpm:4000,inputTpm:4000000,rpd:150000});
 const now=Date.parse('2026-09-21T12:00:00Z');
 assert.equal(quotaDecision(Array.from({length:500},()=>({at:now-60001,inputTokens:1})),1,now).reason,null);
 assert.equal(budgetDecision([{at:now,usd:2}],100,now).reason,'PROVIDER_COST_WAIT');
});
