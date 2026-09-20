import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {claimJob,processJob} from '../src/lib/processing/engine';
import {ProcessingError} from '../src/lib/processing/contracts';
import {processingLanes} from '../src/worker/newsroom-scheduler';
import {accountedReservations,observedCost,budgetDecision,limits} from '../src/worker/provider-guard';
import {latencySummary} from '../src/lib/queue-health';
import {sameValidatedEvent} from '../src/lib/processing/matcher';
import {cleanCases} from './fixtures/newsroom';
import {chooseNewsroomFormat} from '../src/lib/processing/newsroom-format';
import {newsroomView} from '../src/lib/newsroom-view';

test('READY preview bypasses editor; review/manual changes require editor and technical data stays ADMIN-only',()=>{
 const item={validationResult:{editorialEligibility:'READY_TO_PUBLISH'},status:'PENDING_APPROVAL'};
 assert.deepEqual(newsroomView(item,false,'EDITOR'),{ready:true,showEditor:false,showTechnical:false});
 assert.equal(newsroomView(item,true,'EDITOR').showEditor,true);
 assert.equal(newsroomView({...item,humanDraft:{}},false,'EDITOR').showEditor,true);
 assert.deepEqual(newsroomView({status:'NEEDS_REVIEW',validationResult:{editorialEligibility:'NEEDS_REVIEW'}},false,'ADMIN'),{ready:false,showEditor:true,showTechnical:true});
});

test('two lanes overlap without exceeding bounded concurrency',async()=>{
 let active=0,max=0;const release:Array<()=>void>=[];
 const jobs=processingLanes(async()=>{active++;max=Math.max(max,active);await new Promise<void>(r=>release.push(r));active--;});
 assert.equal(active,2);release.forEach(r=>r());await Promise.all(jobs);assert.equal(max,2);assert.equal(active,0);
});
test('known usage settles cost, unknown/malformed/failed reservations remain conservative',()=>{
 const now=Date.now(),at=new Date(now),rows=[{id:'attempt-a',action:'PROVIDER_RESERVED',createdAt:at,metadata:{key:'same-request',usd:.15}},{id:'attempt-b',action:'PROVIDER_RESERVED',createdAt:at,metadata:{key:'same-request',usd:.15}}];
 assert.equal(observedCost({}),null);assert.equal(observedCost({usageMetadata:{promptTokenCount:-1,candidatesTokenCount:2,totalTokenCount:1}}),null);
 const usd=observedCost({usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}});assert.equal(usd,.0004);
 const accounted=accountedReservations([...rows,{action:'PROVIDER_USAGE_SETTLED',createdAt:at,metadata:{reservationId:'attempt-a',usd:usd!}}]);
 assert.deepEqual(accounted.map(r=>r.usd),[.0004,.15]);
 assert.equal(budgetDecision([{at:now,usd:1}],1000,now).allowed,false);assert.equal(limits.dayReservedUsd,1);
});
test('exact validated events need no interpretation; changed facts/speakers remain non-identical',()=>{
 const a=cleanCases()[0].u.event,b=structuredClone(a);b.facts[0].id='different-local-id';b.facts[0].evidence.start+=2;
 assert.equal(sameValidatedEvent(a,b),true);b.facts[0].arabic+=' إضافة';assert.equal(sameValidatedEvent(a,b),false);
});
test('long attributed material uses title attribution and body instead of article-sized FLASH',()=>{
 const u=structuredClone(cleanCases()[0].u);u.event.facts=[u.event.facts[0]];
 u.event.facts[0].speaker={key:'speaker',arabic:'المتحدث',evidence:u.event.facts[0].evidence};
 u.event.facts[0].arabic='تفاصيل التصريح المثبتة في الأدلة. '.repeat(12);
 assert.equal(chooseNewsroomFormat(u,''),'STATEMENT');
});
test('latency metrics omit missing samples rather than inventing zero latency',()=>{
 assert.deepEqual(latencySummary([]),{count:0,medianMs:null,p95Ms:null});assert.deepEqual(latencySummary([10,20,30,40]),{count:4,medianMs:20,p95Ms:40});
});
test('durable fresh/old claims progress within one minute, retain fairness on restart and never duplicate',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));const db=new PrismaClient({datasourceUrl:url});const actor='test-newsroom-'+randomUUID();let sid='';const ids:string[]=[];
 try{
  const exclude=(await db.sourcePost.findMany({select:{id:true}})).map(p=>p.id);
  sid=(await db.source.create({data:{name:actor,handle:actor,platform:'TELEGRAM',url:'https://t.me/offline'}})).id;
  async function add(name:string,age:number){const at=new Date(Date.now()-age);const p=await db.sourcePost.create({data:{sourceId:sid,sourcePostId:name,sourceUrl:'https://t.me/offline/'+name,sourcePublishedAt:at,originalContent:'أعلن المجلس اجتماعاً في طهران.',jobs:{create:{stage:'PROCESS_V1',createdAt:at,availableAt:at}}}});ids.push(p.id);return p.id;}
  const old=await Promise.all([0,1,2].map(i=>add('old'+i,86400000+i*1000))),seen=new Set<string>();const start=Date.now();
  for(let round=0;round<6;round++){
   await add('fresh'+round,0);await add('fresh-b'+round,0);
   // Each call has a new worker identity: fairness survives a worker restart.
   const claims=await Promise.all([0,1].map(()=>claimJob(db,actor,new Date(),true,exclude,true)));
   for(const j of claims){assert(j);assert(!seen.has(j.sourcePostId));seen.add(j.sourcePostId);await db.processingJob.update({where:{id:j.id},data:{status:'COMPLETED',lockedAt:null,lockedBy:null}});}
  }
  assert(old.every(id=>seen.has(id)));assert(seen.size===12);assert(Date.now()-start<60000);
  const budgetPost=await add('budget',0);
  await db.processingJob.updateMany({where:{sourcePostId:budgetPost},data:{maxAttempts:1}});
  for(let i=0;i<3;i++){
   await db.processingJob.updateMany({where:{sourcePostId:budgetPost},data:{availableAt:new Date()}});
   const j=await claimJob(db,actor,new Date(),true,[...exclude,...ids.filter(id=>id!==budgetPost)]);assert(j);
   await processJob(db,j,{id:'offline-budget',live:false,understand:async()=>{throw new ProcessingError('PROVIDER_BUDGET_EXHAUSTED',true);},draft:async()=>null,compare:async()=>null},new AbortController().signal);
   const held=await db.processingJob.findUniqueOrThrow({where:{id:j.id}});assert.equal(held.status,'RETRY');assert.equal(held.attemptCount,0);
  }
 }finally{await db.auditLog.deleteMany({where:{OR:[{actor},{entityId:{in:ids}}]}});await db.processingJob.deleteMany({where:{sourcePostId:{in:ids}}});await db.sourcePost.deleteMany({where:{id:{in:ids}}});if(sid)await db.source.delete({where:{id:sid}});await db.$disconnect();}
});
