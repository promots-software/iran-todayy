import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {cleanCases} from './fixtures/newsroom';
import {official} from './fixtures/processing';
import {claimJob,ingest,processJob,json} from '../src/lib/processing/engine';
import {renderSelection,buildAtoms} from '../src/lib/processing/constrained-rewrite';
import {approvePublication,approvalDigest} from '../src/lib/telegram/publisher';
test('ready flash remains held, explicit approval freezes title-only text without transport',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
 const db=new PrismaClient({datasourceUrl:url}),tag=randomUUID(),c=cleanCases()[0];
 const source=await db.source.create({data:{handle:tag,name:'Offline newsroom',platform:'TELEGRAM',url:'https://t.me/offline',editorialProfile:json(official)}});
 let eventId:string|undefined,itemId:string|undefined;
 try{
  await db.appSettings.upsert({where:{id:1},create:{id:1,publishingMode:'REQUIRE_APPROVAL'},update:{publishingMode:'REQUIRE_APPROVAL'}});
  const p=await ingest(db,source.id,{externalId:'1',url:'https://t.me/offline/1',content:c.source,publishedAt:new Date()});
  const job=await claimJob(db,'offline-newsroom');assert.equal(job?.sourcePostId,p.id);
  const outcome=await processJob(db,job!,{id:'offline-newsroom',live:false,constrainedRewrite:true,
   understand:async()=>c.u,compare:async()=>({relation:'DIFFERENT',rationale:'حدث مختلف في اختبار معزول',newFactIds:[],conflictingFactIds:[]}),
   draft:async()=>renderSelection({titleAtomId:'f1',bodyAtomIds:['f1']},buildAtoms(c.source,c.u))},new AbortController().signal);
  assert.ok(!('error'in outcome),JSON.stringify(outcome));
  const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:p.id}}},include:{eventRevision:true}});itemId=item.id;eventId=item.eventRevision.eventId;
  assert.equal(item.status,'PENDING_APPROVAL');assert.equal(item.validationStatus,'PASSED');assert.equal(item.arabicContent,'');
  assert.equal((item.validationResult as {editorialEligibility:string}).editorialEligibility,'READY_TO_PUBLISH');
  assert.equal((item.validationResult as {deliveryDecision:string}).deliveryDecision,'HOLD');
  assert.equal(await db.publication.count({where:{newsItemId:item.id}}),0);
  const input={newsItemId:item.id,digest:approvalDigest(item),resolutions:[]};
  const env={TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123',AUTO_PUBLISH:'false',SHADOW_MODE:'true',REQUIRE_APPROVAL:'true'};
  const pubs=await Promise.all([approvePublication(db,input,'offline editor',env),approvePublication(db,input,'offline editor',env)]);
  assert.equal(pubs[0].id,pubs[1].id);assert.equal(pubs[0].contentSnapshot,item.title);assert.equal(pubs[0].status,'PENDING');assert.equal(pubs[0].attemptCount,0);
 }finally{
  if(itemId){await db.publication.deleteMany({where:{newsItemId:itemId}});await db.newsEvidence.deleteMany({where:{newsItemId:itemId}});await db.newsItem.delete({where:{id:itemId}});}
  await db.eventMatch.deleteMany({where:{sourcePost:{sourceId:source.id}}});
  if(eventId){await db.eventRevision.deleteMany({where:{eventId}});await db.canonicalEvent.delete({where:{id:eventId}});}
  await db.processingJob.deleteMany({where:{sourcePost:{sourceId:source.id}}});await db.sourcePost.deleteMany({where:{sourceId:source.id}});await db.source.delete({where:{id:source.id}});await db.$disconnect();
 }
});
