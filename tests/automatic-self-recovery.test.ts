import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma,PrismaClient} from '@prisma/client';
import {interruptAutomaticDelivery,recoverAutomaticPolicy,isQuarantined,failureSchedule,probeRecoveryReadiness,recoveryTiming} from '../src/lib/telegram/automatic-recovery';
import {automaticDeliveryCycle} from '../src/lib/telegram/automatic-delivery';
import {autoPolicySchema,type AutoPolicy} from '../src/lib/telegram/auto-policy';
import {automaticControlState} from '../src/lib/telegram/auto-control';
import {safeDeliveryDiagnostics} from '../src/lib/telegram/delivery-diagnostics';
import {publishOne} from '../src/lib/telegram/publisher';
import {publicationCandidateInclude,eligibleAutomatic} from '../src/lib/telegram/publication-policy';
import {fixture,official} from './fixtures/processing';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {operate} from '../src/lib/operations-controls';

const url=new URL(process.env.TEST_DATABASE_URL??'');
if(url.hostname!=='127.0.0.1'||!/^\/(qa_|direct_)/.test(url.pathname))throw Error('ISOLATED_DATABASE_REQUIRED');
const db=new PrismaClient({datasourceUrl:url.href});
const env={AUTO_PUBLISH:'true',SHADOW_MODE:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123'};
let sends=0,storyNumber=0;
const success:typeof fetch=async()=>{sends++;return Response.json({ok:true,result:{message_id:100+sends,chat:{id:-100123}}});};
const uncertain:typeof fetch=async()=>{sends++;throw Error('https://api.telegram.org/botSECRET/sendMessage password=SECRET');};
const policy=async()=>autoPolicySchema.parse((await db.appSettings.findUniqueOrThrow({where:{id:1}})).telegramAutoPolicy);
beforeEach(async()=>{
 await db.$executeRawUnsafe('TRUNCATE "Source", "CanonicalEvent", "Publication", "AuditLog", "WorkerHeartbeat", "DashboardUser" CASCADE');
 await db.appSettings.update({where:{id:1},data:{publishingPaused:false,processingPaused:false,publishingMode:'REQUIRE_APPROVAL',telegramAutoPolicy:Prisma.DbNull}});sends=0;
});
after(()=>db.$disconnect());
async function story(){
 const city='طهران'+String.fromCharCode(0x0627+Math.floor(storyNumber/25),0x0627+(storyNumber++%25));
 const text=`عباس عراقجي يزور ${city} في زيارة رسمية.`;
 const source=await db.source.create({data:{platform:'TELEGRAM',handle:randomUUID(),name:'offline',url:'https://t.me/offline',processingMode:'NORMAL',editorialProfile:official}});
 const post=await ingest(db,source.id,{externalId:randomUUID(),url:source.url+'/1',content:text,publishedAt:new Date()});
 await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});
 const job=await claimJob(db,'offline');assert(job);const f=fixture('recovery'+storyNumber,text,'ar',text);
 for(const a of [f.understanding.event.object!,f.understanding.event.location!,f.understanding.names[1]]){a.arabic=city;if('key' in a)a.key='city:'+city;}f.understanding.event.facts[0].key='visit:'+city;
 await processJob(db,job,{id:'fixture',live:false,understand:async()=>f.understanding,draft:async()=>f.draft,compare:async()=>({relation:'DIFFERENT',rationale:'حدث مختلف',newFactIds:[],conflictingFactIds:[]})},new AbortController().signal);
 const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:post.id}}},include:publicationCandidateInclude});
 const current=autoPolicySchema.safeParse((await db.appSettings.findUniqueOrThrow({where:{id:1}})).telegramAutoPolicy);
 const p:AutoPolicy=current.success?{...current.data,sourceIds:[...current.data.sourceIds,source.id]}:{version:'telegram-auto-v1',id:randomUUID(),state:'ACTIVE',destination:env.TELEGRAM_CHAT_ID,notBefore:new Date(0).toISOString(),sourceIds:[source.id],canaryCandidateId:null,authorizedBy:'offline-owner'};
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:p}});return {item,post,source};
}
async function heartbeats(){
 const p=await policy();for(const id of ['telegram-publisher-worker','telegram-production-worker']){
  const data={state:'IDLE' as const,phase:'TEST',lastSeenAt:new Date(),lastError:null,metadata:id==='telegram-production-worker'?{telegramReady:true}:{autoPublish:true,shadowMode:false,requireApproval:true,externalPublishingEnabled:true,destination:p.destination,policyId:p.id,policyState:p.state}};
  await db.workerHeartbeat.upsert({where:{id},create:{id,...data},update:data});
 }
}
async function due(){const p=await policy();assert(p.recovery);await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p,recovery:{...p.recovery,nextCheckAt:new Date(0).toISOString()}}}});await heartbeats();}
async function fail(){const s=await story();await automaticDeliveryCycle(db,env,uncertain);const p=await db.publication.findUniqueOrThrow({where:{newsItemId:s.item.id},include:{attempts:true}});assert.equal(p.status,'UNKNOWN');return {...s,publication:p};}

test('isolated UNKNOWN quarantines without receipt mutation; cooldown persists through restart; processing continues',async()=>{
 const a=await fail(),p=await policy();assert.equal(p.reason,'TEMPORARY_RECOVERY');assert.equal(Date.parse(p.recovery!.nextCheckAt)-Date.parse(p.recovery!.startedAt),120000);
 assert(await db.$transaction(tx=>isQuarantined(tx,a.publication.id)));
 const before=await db.publication.findUniqueOrThrow({where:{id:a.publication.id},include:{attempts:true}});
 const restarted=new PrismaClient({datasourceUrl:url.href});try{assert.equal(await recoverAutomaticPolicy(restarted,env,async()=>{throw Error('too early');}),false);await automaticDeliveryCycle(restarted,env,uncertain);}finally{await restarted.$disconnect();}
 assert.deepEqual(await db.publication.findUniqueOrThrow({where:{id:a.publication.id},include:{attempts:true}}),before);assert.equal(sends,1);
 const next=await story();assert.equal(next.item.status,'PENDING_APPROVAL');assert.equal((await db.processingJob.findFirstOrThrow({where:{sourcePostId:next.post.id}})).status,'COMPLETED');
 const settings=await db.appSettings.findUniqueOrThrow({where:{id:1}});assert.equal(settings.processingPaused,false);assert.equal(settings.publishingPaused,false);
});

test('fresh DB boundary excludes 26 outage stories, delayed old sources and earlier cycles; only new item sends once',async()=>{
 const a=await fail();const old=[];for(let i=0;i<26;i++)old.push(await story());
 const before=await policy();await due();assert(await recoverAutomaticPolicy(db,env,async()=>null));const next=await policy();assert.notEqual(next.id,before.id);assert.equal(next.state,'ACTIVE');assert(Date.parse(next.notBefore)>Date.parse(before.recovery!.startedAt));
 for(const s of old){const item=await db.newsItem.findUniqueOrThrow({where:{id:s.item.id},include:publicationCandidateInclude});assert(!eligibleAutomatic(item,next));}
 // Processing finishing after recovery cannot make an old source new.
 const delayed=await db.newsItem.update({where:{id:old[0].item.id},data:{createdAt:new Date()},include:publicationCandidateInclude});assert(!eligibleAutomatic(delayed,next));
 const restarted=new PrismaClient({datasourceUrl:url.href});try{await automaticDeliveryCycle(restarted,env,success);}finally{await restarted.$disconnect();}assert.equal(sends,1);
 const fresh=await story();await automaticDeliveryCycle(db,env,success);assert.equal(sends,2);const sent=await db.publication.findUniqueOrThrow({where:{newsItemId:fresh.item.id}});assert.equal(sent.status,'SENT');
 await assert.rejects(publishOne(db,sent.id,env,success));assert.equal(sends,2);await assert.rejects(publishOne(db,a.publication.id,env,success));assert.equal(sends,2);
 assert.equal(await db.publication.count({where:{newsItemId:{in:old.map(s=>s.item.id)}}}),0);
 assert.equal((await db.publication.findUniqueOrThrow({where:{id:a.publication.id}})).status,'UNKNOWN');
 await fail();await due();assert(await recoverAutomaticPolicy(db,env,async()=>null));await automaticDeliveryCycle(db,env,success);assert.equal(sends,3);
});

test('multi-hour worker downtime resumes at a fresh boundary without backlog when readiness is healthy',async()=>{
 await fail();const old=await story();await due();const p=await policy();await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p,recovery:{...p.recovery!,startedAt:new Date(Date.now()-4*3600000).toISOString(),expiresAt:new Date(Date.now()-3600000).toISOString()}}}});
 assert(await recoverAutomaticPolicy(db,env,async()=>null));await automaticDeliveryCycle(db,env,success);assert.equal(sends,1);assert.equal(await db.publication.count({where:{newsItemId:old.item.id}}),0);
});

test('persistent failed readiness checks for 15 minutes require operator intervention',async()=>{
 await fail();await due();const p=await policy();await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p,recovery:{...p.recovery!,checks:3,expiresAt:new Date(0).toISOString()}}}});
 assert.equal(await recoverAutomaticPolicy(db,env,async()=>'TELEGRAM_READINESS_UNAVAILABLE'),false);assert.equal((await policy()).reason,'SYSTEMIC_DELIVERY_FAILURE');
});

test('three independent failures open durable circuit; no endless send or readiness probes',async()=>{
 for(let i=1;i<=3;i++){await fail();const p=await policy();assert.equal(p.consecutiveFailures,i);if(i<3){assert.equal(p.reason,'TEMPORARY_RECOVERY');assert.equal(Date.parse(p.recovery!.nextCheckAt)-Date.parse(p.recovery!.startedAt),i===1?120000:300000);await due();assert(await recoverAutomaticPolicy(db,env,async()=>null));}else{assert.equal(p.reason,'SYSTEMIC_DELIVERY_FAILURE');assert.equal(p.recovery!.circuit,'OPEN');}}
 await story();for(let i=0;i<3;i++){await automaticDeliveryCycle(db,env,uncertain);assert.equal(await recoverAutomaticPolicy(db,env,async()=>{throw Error('must not probe');}),false);}assert.equal(sends,3);
});

for(const blocker of ['emergency','operator','destination','capability','heartbeat','worker','permission'] as const)test(`recovery respects ${blocker} and never sends`,async()=>{
 await fail();await due();let e={...env};
 if(blocker==='emergency')await db.appSettings.update({where:{id:1},data:{publishingPaused:true}});
 if(blocker==='operator'){const p=await policy();const user=await db.dashboardUser.create({data:{username:'operator',displayName:'test',passwordHash:'unused',role:'SUPER_ADMIN'}});await operate(db,user.id,{requestId:randomUUID(),kind:'AUTO_PUBLISH',target:'1',value:'false',expected:`${p.id}:CLOSED`,confirmed:true});}
 if(blocker==='destination')e={...e,TELEGRAM_CHAT_ID:'-999'};
 if(blocker==='capability')e={...e,SHADOW_MODE:'true'};
 if(blocker==='heartbeat')await db.workerHeartbeat.update({where:{id:'telegram-publisher-worker'},data:{lastSeenAt:new Date(0)}});
 if(blocker==='worker')await db.workerHeartbeat.update({where:{id:'telegram-production-worker'},data:{lastError:'OFFLINE'}});
 assert.equal(await recoverAutomaticPolicy(db,e,async()=>blocker==='permission'?'TELEGRAM_POST_PERMISSION_UNVERIFIED':null),false);assert.equal((await policy()).state,'CLOSED');assert.equal(sends,1);
});

test('operator change during external readiness check fences recovery and database boundary',async()=>{
 await fail();await due();assert.equal(await recoverAutomaticPolicy(db,env,async()=>{const p=await policy();await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p,id:randomUUID(),reason:'OPERATOR_DISABLED'}}});return null;}),false);assert.equal((await policy()).reason,'OPERATOR_DISABLED');
});
test('concurrent recovery uses one durable probe lease and one activation revision',async()=>{
 await fail();await due();let probes=0;const results=await Promise.all([1,2].map(()=>recoverAutomaticPolicy(db,env,async()=>{probes++;return null;})));assert.equal(results.filter(Boolean).length,1);assert.equal(probes,1);assert.equal(await db.auditLog.count({where:{action:'AUTOMATIC_DELIVERY_RECOVERED'}}),1);
});
test('old CLOSED incident is not automatically restored by deploying this change',async()=>{
 const a=await fail(),p=await policy();await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p,reason:'DELIVERY_RECONCILIATION_REQUIRED'}}});await due();assert.equal(await recoverAutomaticPolicy(db,env,async()=>null),false);await automaticDeliveryCycle(db,env,success);assert.equal(sends,1);assert.equal((await db.publication.findUniqueOrThrow({where:{id:a.publication.id}})).status,'UNKNOWN');
});
test('quarantine integrity rejects changed receipts',async()=>{
 const a=await fail();await db.publicationAttempt.update({where:{id:a.publication.attempts[0].id},data:{result:{tampered:true}}});await due();assert.equal(await recoverAutomaticPolicy(db,env,async()=>null),false);assert.equal((await policy()).recovery!.blocker,'UNRESOLVED_DELIVERY');
});
test('safe diagnostics persist phase/category and discard raw secrets',async()=>{
 const a=await fail();const audit=await db.auditLog.findUniqueOrThrow({where:{id:`delivery-interruption:${a.publication.id}`}});const data=JSON.stringify(audit);assert(!data.includes('SECRET'));assert(data.includes('TRANSPORT_EXCEPTION'));assert(data.includes('AWAITING_RESPONSE'));assert(data.includes(a.item.id));assert(data.includes('nextCheckAt'));
 const d=safeDeliveryDiagnostics({dispatchBegan:true,phase:'AWAITING_RESPONSE',httpStatus:null,parsingBegan:false,parsingCompleted:false,errorCategory:'TRANSPORT_EXCEPTION',password:'SECRET',message:'SECRET'});assert(!JSON.stringify(d).includes('SECRET'));
});
for(const outcome of ['AI_INVALID_SCHEMA','GEMINI_TRANSPORT_FAILED','DUPLICATE','UNCERTAIN_MATCH','LOW_NEWS_VALUE','UNRELATED_TO_IRAN'])test(`${outcome} does not mutate global automatic policy`,async()=>{
 const s=await story();await db.newsItem.update({where:{id:s.item.id},data:{status:'NEEDS_REVIEW',error:outcome}});const before=await policy();await automaticDeliveryCycle(db,env,success);assert.deepEqual(await policy(),before);assert.equal(sends,0);
});
test('dashboard distinguishes recovery, systemic, operator, active and emergency without fake enabling',async()=>{
 await fail();await heartbeats();const p=await policy(),h=await db.workerHeartbeat.findUniqueOrThrow({where:{id:'telegram-publisher-worker'}});
 assert.equal(automaticControlState(p,false,h).presentation,'TEMPORARY_RECOVERY');assert(automaticControlState(p,false,h).canDisable);assert(!automaticControlState(p,false,h).canEnable);
 assert.equal(automaticControlState(p,true,h).presentation,'EMERGENCY_PAUSE');assert.equal(automaticControlState({...p,reason:'SYSTEMIC_DELIVERY_FAILURE'},false,h).presentation,'SYSTEMIC_SAFETY_STOP');
 assert.equal(automaticControlState({...p,reason:'OPERATOR_DISABLED'},false,h).presentation,'OPERATOR_DISABLED');assert.equal(automaticControlState({...p,state:'ACTIVE'},false,h).presentation,'ACTIVE');assert.equal(automaticControlState(p,false,null).reason,'PUBLISHER_UNAVAILABLE');
});
test('readiness uses only getMe/getChatMember, exact destination, no send; errors are secret safe',async()=>{
 const methods:string[]=[];assert.equal(await probeRecoveryReadiness(env,async(url,init)=>{methods.push(String(url).split('/').at(-1)!);const body=JSON.parse(String(init?.body));if(methods.length===2)assert.deepEqual(body,{chat_id:'-100123',user_id:123});return Response.json({ok:true,result:methods.length===1?{id:123,is_bot:true}:{user:{id:123},status:'administrator',can_post_messages:true}});}),null);assert.deepEqual(methods,['getMe','getChatMember']);
 assert.equal(await probeRecoveryReadiness(env,async()=>{throw Error('SECRET');}),'TELEGRAM_READINESS_UNAVAILABLE');
});
test('low-frequency repeated failures cannot evade circuit by waiting out the rolling window',()=>{
 const p:AutoPolicy={version:'telegram-auto-v1',id:randomUUID(),state:'ACTIVE',destination:'-123',notBefore:new Date(0).toISOString(),sourceIds:[],canaryCandidateId:null,authorizedBy:'test',consecutiveFailures:2,failureTimes:[new Date(0).toISOString()]};assert.equal(failureSchedule(p,new Date()).circuit,'OPEN');assert.equal(recoveryTiming.window,1800000);
});

test('interruption is idempotent across a crash before policy handling',async()=>{
 const s=await story();await automaticDeliveryCycle(db,env,uncertain);const pub=await db.publication.findUniqueOrThrow({where:{newsItemId:s.item.id}});
 const before=await policy();await interruptAutomaticDelivery(db,pub.id);await interruptAutomaticDelivery(db,pub.id);assert.deepEqual(await policy(),before);assert.equal(await db.auditLog.count({where:{id:`delivery-interruption:${pub.id}`}}),1);
});
test('explicit transient 429 is isolated, honors retry_after, and never retries that publication',async()=>{
 const s=await story();await automaticDeliveryCycle(db,env,async()=>{sends++;return Response.json({ok:false,error_code:429,parameters:{retry_after:240}},{status:429});});
 const p=await policy();assert.equal(p.reason,'TEMPORARY_RECOVERY');assert.equal(Date.parse(p.recovery!.nextCheckAt)-Date.parse(p.recovery!.startedAt),240000);
 const pub=await db.publication.findUniqueOrThrow({where:{newsItemId:s.item.id}});assert.equal(pub.status,'FAILED');await due();assert(await recoverAutomaticPolicy(db,env,async()=>null));await automaticDeliveryCycle(db,env,success);assert.equal(sends,1);assert.equal((await db.publication.findUniqueOrThrow({where:{id:pub.id}})).status,'FAILED');
});
test('permanent Telegram permission rejection requires operator instead of automatic retry',async()=>{
 await story();await automaticDeliveryCycle(db,env,async()=>Response.json({ok:false,error_code:403},{status:403}));assert.equal((await policy()).reason,'SYSTEMIC_DELIVERY_FAILURE');assert.equal(await recoverAutomaticPolicy(db,env,async()=>null),false);
});
test('missing durable acknowledgement is never treated as isolated transport evidence',async()=>{
 const s=await story(),p=await policy();await db.publication.create({data:{newsItemId:s.item.id,automaticPolicyId:p.id,idempotencyKey:randomUUID(),destination:env.TELEGRAM_CHAT_ID,contentSnapshot:'offline',status:'SENDING',attemptCount:1,claimedAt:new Date(0)}});
 await automaticDeliveryCycle(db,env,success);assert.equal((await policy()).reason,'SYSTEMIC_DELIVERY_FAILURE');assert.equal(sends,0);
});
test('all factual contributors and source-specific activation times must satisfy recovery boundary',async()=>{
 const a=await story(),p=await policy();assert(eligibleAutomatic(a.item,p));
 const changed=structuredClone(a.item);changed.evidence[0].sourcePost.sourcePublishedAt=new Date(0);
 assert(!eligibleAutomatic(changed,{...p,notBefore:new Date(Date.now()-60000).toISOString()}));
 assert(!eligibleAutomatic(a.item,{...p,sourceNotBefore:{[a.source.id]:new Date(Date.now()+60000).toISOString()}}));
 assert(!eligibleAutomatic(a.item,{...p,sourceNotBefore:{}}));
});
test('systemic recovery requires supported operator acknowledgement before forward-only enable',async()=>{
 await fail();await due();const p=await policy();await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p,reason:'SYSTEMIC_DELIVERY_FAILURE',recovery:{...p.recovery!,circuit:'OPEN'}}}});await heartbeats();
 const user=await db.dashboardUser.create({data:{username:'owner',displayName:'offline',passwordHash:'unused',role:'SUPER_ADMIN'}});
 await operate(db,user.id,{requestId:randomUUID(),kind:'AUTO_PUBLISH_RECOVERY',target:'1',value:'ACKNOWLEDGE',expected:`${p.id}:CLOSED:SYSTEMIC_DELIVERY_FAILURE`,confirmed:true});
 assert.equal((await policy()).reason,'OPERATOR_DISABLED');assert.equal((await policy()).recovery,undefined);
 await operate(db,user.id,{requestId:randomUUID(),kind:'AUTO_PUBLISH',target:'1',value:'true',expected:`${p.id}:CLOSED`,confirmed:true});assert.equal((await policy()).state,'ACTIVE');assert.equal((await policy()).consecutiveFailures,0);assert(Date.parse((await policy()).notBefore)>Date.parse(p.notBefore));assert.equal(sends,1);
});
test('recovery boundary is bracketed by database time and delivery waits for the new publisher acknowledgement',async()=>{
 await fail();await due();const old=await policy();const before=(await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now;
 assert(await recoverAutomaticPolicy(db,env,async()=>null));const p=await policy();const after=(await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now;
 assert(new Date(p.notBefore)>=before&&new Date(p.notBefore)<=after);await story();
 assert.equal((await automaticDeliveryCycle(db,env,success,undefined,`${old.id}:CLOSED`)).status,'AWAITING_POLICY_ACKNOWLEDGEMENT');assert.equal(sends,1);
 await automaticDeliveryCycle(db,env,success,undefined,`${p.id}:ACTIVE`);assert.equal(sends,2);
});
test('crash after durable UNKNOWN receipt but before interruption is recovered without another send',async()=>{
 const s=await fail();const closed=await policy();
 // Isolated fixture recreates the exact earlier crash boundary, retaining receipt.
 await db.auditLog.deleteMany({where:{id:{in:[`delivery-interruption:${s.publication.id}`,`delivery-quarantine:${s.publication.id}`]}}});
 const {recovery:_recovery,reason:_reason,...original}=closed;void _recovery;void _reason;
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...original,state:'ACTIVE',consecutiveFailures:0,failureTimes:[]}}});
 await automaticDeliveryCycle(db,env,uncertain);assert.equal((await policy()).reason,'TEMPORARY_RECOVERY');assert.equal(sends,1);
});
test('legacy database approval invariant prevents automatic recovery',async()=>{
 await fail();await due();await db.appSettings.update({where:{id:1},data:{publishingMode:'AUTO_PUBLISH'}});
 assert.equal(await recoverAutomaticPolicy(db,env,async()=>null),false);assert.equal((await policy()).recovery!.blocker,'LEGACY_POLICY_MISMATCH');assert.equal(sends,1);
});
test('durable SENT survives a crash before resetting the consecutive-failure counter',async()=>{
 const s=await story();await automaticDeliveryCycle(db,env,success);const p=await policy();
 // The historical incidents are outside the rolling window; SENT is newer.
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...p,consecutiveFailures:2,failureTimes:[new Date(Date.now()-3600000).toISOString()]}}});
 assert.equal((await db.publication.findUniqueOrThrow({where:{newsItemId:s.item.id}})).status,'SENT');
 await fail();assert.equal((await policy()).consecutiveFailures,1);assert.equal((await policy()).recovery!.circuit,'COOLDOWN');
});
