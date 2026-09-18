import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {fixture,fixtureProvider,official} from './fixtures/processing';
import {buildAtoms,renderSelection} from '../src/lib/processing/constrained-rewrite';
import {publicationText} from '../src/lib/telegram/publisher';

test('offline Telegram ingestion to constrained draft, dashboard approval, frozen single delivery and audit',{
 skip:!process.env.TEST_DATABASE_URL||!process.env.TEST_BASE_URL,
},async()=>{
 const url=process.env.TEST_DATABASE_URL!,base=process.env.TEST_BASE_URL!;
 assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
 const db=new PrismaClient({datasourceUrl:url});
 const tag=randomUUID().replaceAll('-',''),ids:string[]=[];
 const f=fixture('offline-publication-path-'+tag,'عباس عراقجي يزور طهران');
 const provider=Object.assign(fixtureProvider([f]),{constrainedRewrite:true});
 provider.draft=async()=>renderSelection({titleAtomId:f.understanding.event.facts[0].id,bodyAtomIds:f.understanding.event.facts.map(x=>x.id)},buildAtoms(f.content,f.understanding));
 let sourceId='',postId='',newsId='',eventId='',publicationId='';
 const authorization='Basic '+Buffer.from(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`).toString('base64');
 const decode=(s:string)=>s.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
 try{
  await db.appSettings.upsert({where:{id:1},create:{id:1,publishingMode:'REQUIRE_APPROVAL'},update:{publishingMode:'REQUIRE_APPROVAL'}});
  const source=await db.source.create({data:{platform:'TELEGRAM',handle:'offline'+tag,name:'OFFLINE TEST ONLY',url:'https://t.me/offline_fixture',editorialProfile:official}});sourceId=source.id;
  const post=await ingest(db,source.id,{externalId:'1',content:f.content,publishedAt:new Date(),url:source.url+'/1',metadata:{offlineFixture:true}},true);postId=post.id;
  const replay=await ingest(db,source.id,{externalId:'1',content:f.content,publishedAt:new Date(),url:source.url+'/1',metadata:{offlineFixture:true}},true);
  assert.equal(post.id,replay.id);
  const otherJobs=await db.processingJob.findMany({where:{sourcePostId:{not:postId}},select:{sourcePostId:true}});
  const claimed=await claimJob(db,'offline-publish-path',new Date(),true,otherJobs.map(j=>j.sourcePostId));assert.ok(claimed);assert.equal(claimed.sourcePostId,postId);
  const processed=await processJob(db,claimed,provider,new AbortController().signal);
  assert.equal('error' in processed,false);
  const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:postId}}},include:{eventRevision:true}});newsId=item.id;eventId=item.eventRevision.eventId;
  assert.equal(item.status,'NEEDS_REVIEW');assert.equal(item.validationStatus,'NEEDS_REVIEW');
  assert.equal(await db.publication.count({where:{newsItemId:item.id}}),0);
  const route='/news/'+item.id;
  assert.equal((await fetch(base+route)).status,401);
  const page=await fetch(base+route,{headers:{authorization}});assert.equal(page.status,200);
  const html=await page.text();assert.ok(html.includes(f.content));
  const form=[...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m=>m[0]).find(s=>s.includes('name="confirm"')&&s.includes('name="digest"'));assert.ok(form);
  const payload=new FormData();
  for(const [input] of form.matchAll(/<input\b[^>]*>/g)){
   if(!input.includes('type="hidden"'))continue;
   const key=input.match(/name="([^"]*)"/)?.[1];if(key)payload.append(decode(key),decode(input.match(/value="([^"]*)"/)?.[1]??''));
  }
  for(const [textarea] of form.matchAll(/<textarea\b[^>]*>/g)){
   const key=textarea.match(/name="([^"]*)"/)?.[1];if(key)payload.set(decode(key),'Offline synthetic fixture: explicit simulated editor review, never a production attestation.');
  }
  const submit=()=>fetch(base+route,{method:'POST',headers:{authorization,origin:base},body:payload});
  // An actual authenticated server action without explicit confirmation must not approve.
  assert.equal((await submit()).status,200);
  assert.equal(await db.publication.count({where:{newsItemId:item.id}}),0);
  payload.set('confirm','on');assert.equal((await submit()).status,200);
  const frozen=await db.publication.findUniqueOrThrow({where:{newsItemId:item.id}});publicationId=frozen.id;
  assert.equal(frozen.status,'PENDING');assert.equal(frozen.attemptCount,0);assert.equal(frozen.contentSnapshot,publicationText(item));
  assert.equal(await db.auditLog.count({where:{action:'MANUAL_PUBLICATION_APPROVED',entityId:frozen.id}}),1);
  const approvedHtml=await (await fetch(base+route,{headers:{authorization}})).text();
  const sendForm=[...approvedHtml.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m=>m[0]).find(s=>s.includes('name="confirmSend"'));assert.ok(sendForm);
  assert.ok(approvedHtml.includes(frozen.destination));
  const sendPayload=new FormData();
  for(const [input] of sendForm.matchAll(/<input\b[^>]*>/g)){
   if(!input.includes('type="hidden"'))continue;
   const key=input.match(/name="([^"]*)"/)?.[1];if(key)sendPayload.append(decode(key),decode(input.match(/value="([^"]*)"/)?.[1]??''));
  }
  const send=(auth=true)=>fetch(base+route,{method:'POST',headers:auth?{authorization,origin:base}:{origin:base},body:sendPayload});
  sendPayload.set('confirmSend','on');assert.equal((await send(false)).status,401);
  assert.equal((await db.publication.findUniqueOrThrow({where:{id:frozen.id}})).attemptCount,0);
  sendPayload.delete('confirmSend');assert.equal((await send()).status,200);
  assert.equal((await db.publication.findUniqueOrThrow({where:{id:frozen.id}})).attemptCount,0);
  sendPayload.set('confirmSend','on');
  // The local Next server must use tests/helpers/manual-publish-transport.cjs.
  await Promise.all([send(),send()]);await send();
  const sent=await db.publication.findUniqueOrThrow({where:{id:frozen.id},include:{attempts:true}});
  assert.equal(sent.status,'SENT');assert.equal(sent.telegramMessageId,'777');assert.equal(sent.attemptCount,1);assert.equal(sent.attempts.length,1);assert.ok(sent.attempts[0].finishedAt);
  assert.equal((await db.newsItem.findUniqueOrThrow({where:{id:item.id}})).status,'PUBLISHED');
  for(const action of ['PUBLICATION_SEND_STARTED','PUBLICATION_SENT'])assert.equal(await db.auditLog.count({where:{action,entityId:frozen.id}}),1);
 }finally{
  if(publicationId){await db.publicationAttempt.deleteMany({where:{publicationId}});await db.publication.deleteMany({where:{id:publicationId}});ids.push(publicationId);}
  if(newsId){await db.newsEvidence.deleteMany({where:{newsItemId:newsId}});await db.newsItem.deleteMany({where:{id:newsId}});}
  if(postId){await db.eventMatch.deleteMany({where:{sourcePostId:postId}});await db.processingJob.deleteMany({where:{sourcePostId:postId}});ids.push(postId);}
  if(eventId){await db.eventRevision.deleteMany({where:{eventId}});await db.canonicalEvent.deleteMany({where:{id:eventId}});}
  if(sourceId){await db.sourcePost.deleteMany({where:{sourceId}});await db.source.deleteMany({where:{id:sourceId}});}
  await db.auditLog.deleteMany({where:{entityId:{in:ids}}});await db.$disconnect();
 }
});
