import {reviewedResponse} from './fixtures/direct-reviewed';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {automaticDeliveryCycle,eligibleAutomatic} from '../src/lib/telegram/automatic-delivery';
import {armAutomaticPolicy} from '../src/lib/telegram/auto-authorization';
import type {AutoPolicy} from '../src/lib/telegram/auto-policy';
import {fixture,official} from './fixtures/processing';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {AssumedPropositionGemini as GeminiLanguageProvider} from './fixtures/proposition-mock';
const env={AUTO_PUBLISH:'true',SHADOW_MODE:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123'};
const include={humanDraft:true,publication:true,eventRevision:true,evidence:{include:{sourcePost:{include:{source:true,jobs:true,matches:true,humanDraft:true}}}}} as const;
for(const mode of ['NORMAL','DIRECT'] as const)test(mode+' canary gates, human safety, concurrency, journal and restart',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
 const content=mode==='NORMAL'?'عباس عراقجي يزور طهران':'افتتح المجلس مدرسة جديدة في العاصمة.';
 const source=await db.source.create({data:{platform:'TELEGRAM',handle:'offline_'+mode.toLowerCase(),name:'offline',url:'https://t.me/offline',processingMode:mode,editorialProfile:official}});
 const post=await ingest(db,source.id,{externalId:'1',url:source.url+'/1',content,publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});
 const job=await claimJob(db,'auto');assert(job);
 const f=fixture('automatic',content);
 const ev=(excerpt:string)=>({excerpt,context:content});
 const raw={actors:[ev('المجلس')],action:ev('افتتح'),object:ev('مدرسة جديدة'),location:ev('العاصمة'),event_time:null,statements:[{evidence:ev(content),speaker:null,kind:'FACT',material:false}],safety:{filterReason:'NONE',priority:'P4',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false},coverage:[{unitId:'u1',factIds:['f1'],nonFactual:false}],publication:{title:{text:content.slice(0,-1),factIds:['f1']},body:[]}};
 const direct=new GeminiLanguageProvider('offline',async(_url,init)=>{const {publication,...matching}=raw;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(reviewedResponse(JSON.parse(String(init?.body)),matching,{title:publication.title.text,body:'',diagnostics:[]}))}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}});});
 await processJob(db,job,mode==='DIRECT'?direct:{id:'fixture',live:false,understand:async()=>f.understanding,draft:async()=>f.draft,compare:async()=>({relation:'DIFFERENT',rationale:'حدث مختلف',newFactIds:[],conflictingFactIds:[]})},new AbortController().signal);
 const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:post.id}}},include});
 const policy:AutoPolicy={version:'telegram-auto-v1',id:randomUUID(),state:'CANARY',destination:env.TELEGRAM_CHAT_ID,notBefore:new Date(Date.now()-60000).toISOString(),sourceIds:[source.id],canaryCandidateId:item.id,authorizedBy:'offline-owner'};
 assert.equal(eligibleAutomatic(item,policy),true);
 assert.equal(eligibleAutomatic(item,{...policy,notBefore:new Date(Date.now()+60000).toISOString()}),false);
 assert.equal(eligibleAutomatic(item,{...policy,sourceIds:['different-real-source']}),false);
 for(const mutate of [(x:typeof item)=>{x.validationResult={...Object(x.validationResult),review:[{code:'UNSUPPORTED_OUTPUT'}]};},(x:typeof item)=>{x.status='NEEDS_REVIEW';},(x:typeof item)=>{x.humanDraft={id:'edited'} as typeof x.humanDraft;},(x:typeof item)=>{x.evidence[0].sourcePost.jobs[0].status='RETRY';},(x:typeof item)=>{x.evidence[0].sourcePost.source.processingMode=mode==='DIRECT'?'NORMAL':'DIRECT';}]){const x=structuredClone(item);mutate(x);assert.equal(eligibleAutomatic(x,policy),false);}
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...policy,state:'CLOSED',reason:'OFFLINE_RESET'}}});
 await assert.rejects(armAutomaticPolicy(db,{state:'ACTIVE',destination:env.TELEGRAM_CHAT_ID,notBefore:new Date(),sourceIds:[source.id],canaryCandidateId:null,priorCanaryId:policy.id},'offline'),/VERIFIED_CANARY_REQUIRED/);
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
 let sends=0;const transport:typeof fetch=async(_url,init)=>{sends++;const body=JSON.parse(String(init?.body));assert.equal(body.parse_mode,'HTML');assert.match(body.text,/^<b>إيران الآن \| /);assert.equal(body.chat_id,'-100123');return Response.json({ok:true,result:{message_id:mode==='NORMAL'?201:202,chat:{id:-100123}}});};
 for(const patch of [{AUTO_PUBLISH:'false'},{TELEGRAM_PUBLISH_ENABLED:'false'},{SHADOW_MODE:'true'}])assert.equal((await automaticDeliveryCycle(db,{...env,...patch},transport)).status,'DISABLED');
 await db.appSettings.update({where:{id:1},data:{publishingPaused:true}});assert.equal((await automaticDeliveryCycle(db,env,transport)).status,'PAUSED');await db.appSettings.update({where:{id:1},data:{publishingPaused:false}});assert.equal(sends,0);
 await Promise.allSettled([automaticDeliveryCycle(db,env,transport),automaticDeliveryCycle(db,env,transport)]);
 const pub=await db.publication.findUniqueOrThrow({where:{newsItemId:item.id},include:{attempts:true}});assert.equal(sends,1);assert.equal(pub.status,'SENT');assert.equal(pub.automaticPolicyId,policy.id);assert.equal(pub.attempts.length,1);assert.equal(await db.auditLog.count({where:{entityId:pub.id,action:'PUBLICATION_SENT'}}),1);
 await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);assert.equal(await db.publication.count({where:{destination:'WEB'}}),0);
 assert.equal((await db.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode,'REQUIRE_APPROVAL');
 const active=await armAutomaticPolicy(db,{state:'ACTIVE',destination:env.TELEGRAM_CHAT_ID,notBefore:new Date(),sourceIds:[source.id],canaryCandidateId:null,priorCanaryId:policy.id},'offline');assert.equal(active.state,'ACTIVE');
 await assert.rejects(armAutomaticPolicy(db,{state:'ACTIVE',destination:env.TELEGRAM_CHAT_ID,notBefore:new Date(),sourceIds:[source.id],canaryCandidateId:null,priorCanaryId:policy.id},'offline'),/AUTOMATIC_POLICY_ALREADY_ACTIVE/);assert.equal(sends,1);
 }finally{await db.$disconnect();}
});
