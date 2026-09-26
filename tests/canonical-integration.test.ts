import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {processJob} from '../src/lib/processing/engine';
import type {LanguageProvider} from '../src/lib/processing/contracts';
import {publicationCandidateInclude,publicationReady,eligibleAutomatic} from '../src/lib/telegram/publication-policy';
import {automaticDeliveryCycle} from '../src/lib/telegram/automatic-delivery';
import type {AutoPolicy} from '../src/lib/telegram/auto-policy';
import {assertStagingDestination} from '../src/lib/telegram/staging-guard';
const check=(fail=false)=>({sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:fail&&i===33?'FAIL':'PASS',defects:fail&&i===33?[{defect:'معلومة غير مدعومة',correction:'احذف الإضافة',sourceQuote:null,articleQuote:'إيران الآن |'}]:[]}]))});

test('canonical staging DB: approved -> dedup -> unchanged manual/automatic freeze boundaries',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url.href});const old=process.env.IRAN_TODAY_ENVIRONMENT;process.env.IRAN_TODAY_ENVIRONMENT='staging';
 const noLegacy=async()=>{throw Error('LEGACY_EDITORIAL_PATH_CALLED');};
 try{
  await db.appSettings.update({where:{id:1},data:{publishingMode:'REQUIRE_APPROVAL',publishingPaused:false}});
  async function run(mode:'NORMAL'|'DIRECT',relation='DIFFERENT_OCCURRENCE',update=false,failed=false){
   const source=await db.source.create({data:{name:'offline',handle:randomUUID(),platform:'TELEGRAM',url:'https://example.invalid',processingMode:mode}});
   const content='أعلنت بلدية طهران افتتاح مكتبة عامة '+randomUUID();
   const post=await db.sourcePost.create({data:{sourceId:source.id,sourcePostId:randomUUID(),sourceUrl:'https://example.invalid/1',originalContent:content,normalizedContent:content,sourcePublishedAt:new Date()}});
   const job=await db.processingJob.create({data:{sourcePostId:post.id,stage:'PROCESS_V1',status:'RUNNING',lockedAt:new Date(),lockedBy:randomUUID(),attemptCount:1},include:{sourcePost:{include:{source:true}}}});
   let corrections=0;const stages:string[]=[];
   const provider:LanguageProvider={id:'offline-canonical',live:false,generationFirst:true,understand:noLegacy,draft:noLegacy,compare:noLegacy,canonicalRequest:async request=>{
    stages.push(request.stage);
    if(request.stage==='canonical_intake')return {iranRelated:true,rationale:'طهران'};
    if(request.stage==='canonical_generate'||request.stage==='canonical_correct'){if(request.stage==='canonical_correct')corrections++;return {title:'إيران الآن | افتتاح مكتبة في طهران',body:content};}
    if(request.stage==='canonical_check')return check(failed);
    if(relation==='BROKEN')return {matches:{}};
    const input=request.input as {candidates:{id:string}[]};return {matches:Object.fromEntries(input.candidates.map((c,i)=>[c.id,{relation:i===0?relation:'DIFFERENT_OCCURRENCE',materialUpdate:update,conflict:false,rationale:'Offline matching fixture'}]))};
   }};
   const result=await processJob(db,job,provider,AbortSignal.timeout(20000));if(relation!=='BROKEN')assert.ok(!('error'in result),JSON.stringify(result));
   const after=await db.sourcePost.findUniqueOrThrow({where:{id:post.id}});return {source,post,after,stages,corrections};
  }
  const first=await run('NORMAL');assert.equal(first.after.status,'PENDING_APPROVAL');
  assert.deepEqual(first.stages,['canonical_intake','canonical_generate','canonical_check']);
  let item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:first.post.id}}},include:publicationCandidateInclude});assert.equal(publicationReady(item),true);
  const policy:AutoPolicy={version:'telegram-auto-v1',id:randomUUID(),state:'CLOSED',destination:'-1004436536617',notBefore:new Date(0).toISOString(),sourceIds:[first.source.id],canaryCandidateId:null,authorizedBy:'offline'};
  assert.equal(eligibleAutomatic(item,policy),false);assert.equal(await db.publication.count(),0);
  policy.state='ACTIVE';assert.equal(eligibleAutomatic(item,policy),true);
  await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
  const env={TELEGRAM_BOT_TOKEN:'123:offline',IRAN_TODAY_ENVIRONMENT:'staging',AUTO_PUBLISH:'true',SHADOW_MODE:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_CHAT_ID:policy.destination};
  let sends=0;const transport:typeof fetch=async()=>{sends++;return Response.json({ok:true,result:{message_id:9901,chat:{id:-1004436536617}}});};
  const delivered=await automaticDeliveryCycle(db,env,transport);assert.equal(delivered.status,'SENT');assert.equal(sends,1);assert.equal(await db.publicationAttempt.count(),1);await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);
  const duplicate=await run('DIRECT','SAME_OCCURRENCE');assert.equal(duplicate.after.status,'DUPLICATE');assert.equal(await db.newsItem.count(),1);
  const update=await run('DIRECT','SAME_OCCURRENCE',true);assert.equal(update.after.status,'PENDING_APPROVAL');
  item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:update.post.id}}},include:publicationCandidateInclude});assert.equal(publicationReady(item),true);assert.equal(item.eventRevision.revision,2);
  const failure=await run('NORMAL','DIFFERENT_OCCURRENCE',false,true);assert.equal(failure.after.status,'NEEDS_REVIEW');assert.equal(failure.corrections,2);assert.equal(await db.newsItem.count(),2);
  await db.newsItem.update({where:{id:item.id},data:{title:'تغيير غير معتمد'}});item=await db.newsItem.findUniqueOrThrow({where:{id:item.id},include:publicationCandidateInclude});assert.equal(publicationReady(item),false);
  const held=await run('NORMAL','BROKEN');assert.equal((held.after.processingResult as {editorialStatus:string}).editorialStatus,'APPROVED');assert.equal((held.after.processingResult as {editorialEligibility:string}).editorialEligibility,'MATCHING_HOLD');assert.equal(held.corrections,0);
  assert.throws(()=>assertStagingDestination({...env,TELEGRAM_CHAT_ID:'-1004297263933'}),/STAGING_DESTINATION_REJECTED/);
 }finally{await db.$disconnect();if(old===undefined)delete process.env.IRAN_TODAY_ENVIRONMENT;else process.env.IRAN_TODAY_ENVIRONMENT=old;}
});
