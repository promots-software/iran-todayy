import test from 'node:test';import assert from 'node:assert/strict';import {PrismaClient,Prisma} from '@prisma/client';
import {readBudgetSummary,summaryQuota} from '../src/worker/provider-budget-summary';
import {accountedReservations,budgetRetryDelay,costTelemetry,geminiResource} from '../src/worker/provider-guard';
import {quotaDecision,pacificDay} from '../src/worker/provider-quota';import {capacityState} from '../src/worker/provider-capacity';
const local={skip:!process.env.TEST_DATABASE_URL};
test('SQL rolling summary equals historical accounting across settlements, expiry, resource and restart',local,async()=>{
 assert.equal(new URL(process.env.TEST_DATABASE_URL!).hostname,'127.0.0.1');let db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});const now=Date.UTC(2026,8,27,18),rows:{id:string;action:string;createdAt:Date;metadata:Record<string,unknown>}[]=[];
 const add=(id:string,action:string,at:number,metadata:Record<string,unknown>)=>rows.push({id,action,createdAt:new Date(at),metadata});
 for(let i=0;i<500;i++)add('r'+i,'PROVIDER_RESERVED',now-i*173000,{usd:.009,inputTokens:1000,resource:geminiResource});
 for(let i=0;i<300;i++)add('s'+i,'PROVIDER_USAGE_SETTLED',now-i*172000,{reservationId:'r'+i,usd:.001,inputTokens:20});
 add('s-again','PROVIDER_USAGE_SETTLED',now,{reservationId:'r0',usd:.002,inputTokens:30});
 add('block','PROVIDER_CAPACITY_BLOCKED',now-1000,{resource:geminiResource,until:now+60000});
 add('other','PROVIDER_CAPACITY_HEALTHY',now,{resource:'other',requestStartedAt:now});
 try{await db.auditLog.createMany({data:rows.map(r=>({...r,metadata:r.metadata as Prisma.InputJsonValue,entityType:'ProviderBudget',entityId:'gemini',message:'offline'}))});
 for(const time of [now,now+60000,now+3600000,now+86400000]){
 const retained=rows.filter(r=>r.createdAt.getTime()>Math.min(time-86400000,pacificDay(time).start)-1);
 const actual=await readBudgetSummary(db,time,geminiResource,.006,100,2),expected=costTelemetry(retained,time);
 assert(Math.abs(actual.accountedUsd-expected.accountedUsd)<1e-10);assert(Math.abs(actual.outstandingUsd-expected.outstandingReservedUsd)<1e-10);
 assert.equal(actual.budgetWaitMs,budgetRetryDelay(accountedReservations(retained),0,time,4000));
 assert.deepEqual(capacityState(actual.capacityRows,geminiResource,time),capacityState(retained,geminiResource,time));
 const q=retained.filter(r=>r.action==='PROVIDER_RESERVED').map(r=>({at:r.createdAt.getTime(),inputTokens:r.id==='r0'?30:Number(r.id.slice(1))<300?20:1000}));assert.deepEqual(summaryQuota(actual,100,time),quotaDecision(q,100,time));assert(Buffer.byteLength(JSON.stringify(actual))<2000);
 }
 const before=await readBudgetSummary(db,now,geminiResource,.006,100,2);await db.$disconnect();db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});assert.deepEqual(await readBudgetSummary(db,now,geminiResource,.006,100,2),before);
 }finally{await db.$disconnect();}
});
import {costWaitRecheckBefore} from '../src/worker/provider-guard';
test('early cost retry cutoff survives restart through persisted updatedAt and excludes recent failures',()=>{const now=Date.now();const fresh={observedAt:now,state:'AVAILABLE',quotas:{reason:null},costRolling24hUsd:0} as Parameters<typeof costWaitRecheckBefore>[0];const cutoff=costWaitRecheckBefore(fresh,now)!;assert.equal(cutoff.getTime(),now-300000);assert(!(new Date(now-30000)<cutoff));assert(new Date(now-300001)<cutoff);assert.equal(costWaitRecheckBefore({...fresh!,observedAt:now+30000},now+30000)!.getTime(),now-270000);});
test('SQL summary preserves quota saturation, healthy recovery and corrupt-reservation fail-closed',local,async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});const now=Date.UTC(2026,9,1,8);try{await db.auditLog.createMany({data:[{id:'quota-r',action:'PROVIDER_RESERVED',createdAt:new Date(now-1000),metadata:{usd:.01,inputTokens:4000000}},{id:'quota-b',action:'PROVIDER_CAPACITY_BLOCKED',createdAt:new Date(now-2000),metadata:{resource:geminiResource,until:now+60000}},{id:'quota-h',action:'PROVIDER_CAPACITY_HEALTHY',createdAt:new Date(now),metadata:{resource:geminiResource,requestStartedAt:now}}].map(r=>({...r,entityType:'ProviderBudget',entityId:'gemini',message:'offline'}))});const r=await readBudgetSummary(db,now,geminiResource,.006,1,2);assert.equal(summaryQuota(r,1,now).reason,'PROVIDER_TPM_WAIT');assert.equal(r.minuteWaitMs,59000);assert.deepEqual(capacityState(r.capacityRows,geminiResource,now),{waitMs:0,probe:false});const expired=await readBudgetSummary(db,now+59000,geminiResource,.006,1,2);assert.equal(summaryQuota(expired,1,now+59000).reason,null);await db.auditLog.create({data:{action:'PROVIDER_RESERVED',entityType:'ProviderBudget',entityId:'gemini',message:'offline',createdAt:new Date(now),metadata:{usd:'not-money',inputTokens:-1}}});const invalid=await readBudgetSummary(db,now,geminiResource,.006,1,2);assert(invalid.invalidCost);assert(invalid.invalidQuota);}finally{await db.$disconnect();}
});

test('expired capacity block admits only one recovery probe across concurrent clients',local,async()=>{
 const a=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),b=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const {guardedTransport}=await import('../src/worker/provider-guard');let calls=0;
 try{
  await a.auditLog.deleteMany({where:{entityType:'ProviderBudget'}});
  await a.auditLog.create({data:{action:'PROVIDER_CAPACITY_BLOCKED',entityType:'ProviderBudget',entityId:'gemini',message:'offline',createdAt:new Date(Date.now()-10000),metadata:{resource:geminiResource,until:Date.now()-1}}});
  const stub=async()=>{calls++;await new Promise(r=>setTimeout(r,40));return Response.json({error:{status:'UNAVAILABLE'}},{status:503});};
  const req={method:'POST',body:JSON.stringify({generationConfig:{maxOutputTokens:1024},contents:[]})};
  const results=await Promise.allSettled([guardedTransport(a,'probe-a',stub)('https://'+geminiResource,req),guardedTransport(b,'probe-b',stub)('https://'+geminiResource,req)]);
  assert.equal(calls,1);assert(results.every(r=>r.status==='rejected'));
  assert.equal(await a.auditLog.count({where:{action:'PROVIDER_CAPACITY_PROBE'}}),1);
  assert.equal(await a.auditLog.count({where:{action:'PROVIDER_RESERVED'}}),1);
 }finally{await a.$disconnect();await b.$disconnect();}
});
