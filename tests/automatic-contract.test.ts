import {newsPage} from '../src/lib/dashboard-pagination';
import {workflowState} from '../src/lib/workflow-state';
import {reviewedResponse} from './fixtures/direct-reviewed';
import {reconcileSourceAuthorization} from '../src/lib/telegram/source-authorization';
import {changeSource} from '../src/lib/source-service';
import test,{beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,Prisma} from '@prisma/client';
import {automaticDeliveryCycle,eligibleAutomatic} from '../src/lib/telegram/automatic-delivery';
import {publicationCandidateInclude as include} from '../src/lib/telegram/publication-policy';
import {publishReadyDirect} from '../src/lib/telegram/direct-auto';
import {approvalDigest,freezeValidatedPublication,publishOne,publicationText} from '../src/lib/telegram/publisher';
import {fixture,official} from './fixtures/processing';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {ProcessingError} from '../src/lib/processing/contracts';
import {editorialDecision} from '../src/lib/processing/editorial-eligibility';
import {saveHumanDraft,approveHumanDraft} from '../src/lib/human-editorial';
import {humanDigest} from '../src/lib/human-editorial-contract';
import {changeSourceProcessingMode} from '../src/lib/source-service';
const url=new URL(process.env.TEST_DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||!/^\/(direct_|qa_)/.test(url.pathname))throw Error('ISOLATED_DATABASE_REQUIRED');
const db=new PrismaClient({datasourceUrl:url.href});
const env={AUTO_PUBLISH:'true',SHADOW_MODE:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123'};
const content='عباس عراقجي يزور طهران في زيارة رسمية.';let sends=0;
const transport:typeof fetch=async(_url,init)=>{sends++;assert.equal(JSON.parse(String(init?.body)).chat_id,'-100123');return Response.json({ok:true,result:{message_id:700+sends,chat:{id:-100123}}});};
async function reset(){await db.$executeRawUnsafe('TRUNCATE TABLE "Source", "CanonicalEvent", "AuditLog" CASCADE');await db.appSettings.update({where:{id:1},data:{publishingMode:'REQUIRE_APPROVAL',publishingPaused:false,processingPaused:false,telegramAutoPolicy:Prisma.DbNull}});sends=0;}
beforeEach(reset);after(()=>db.$disconnect());
async function make(mode:'NORMAL'|'DIRECT',options:{initialMode?:'NORMAL'|'DIRECT';failure?:boolean;text?:string;sourceId?:string;city?:string}={}){
 const city=options.city||'طهران',text=options.text||content.replace('طهران',city);
 const source=options.sourceId?await db.source.findUniqueOrThrow({where:{id:options.sourceId}}):await db.source.create({data:{platform:'TELEGRAM',handle:randomUUID(),name:'offline',url:'https://t.me/offline',processingMode:options.initialMode||mode,editorialProfile:official}});
 if(options.initialMode)await changeSourceProcessingMode(db,source.id,mode,'offline-admin');
 const post=await ingest(db,source.id,{externalId:randomUUID(),url:source.url+'/1',content:text,publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});
 const job=await claimJob(db,'matrix');assert(job);assert.equal(job.sourcePostId,post.id);
 const f=fixture('matrix',text,'ar',text),e=(excerpt:string)=>({excerpt,context:text});
 if(options.city){for(const a of [f.understanding.event.object!,f.understanding.event.location!,f.understanding.names[1]]){a.arabic=city;if('key' in a)a.key='city:'+city;}f.understanding.event.facts[0].key='visit:'+city;}
 const raw={actors:[e('عباس عراقجي')],action:e('يزور'),object:null,location:e(city),event_time:null,statements:[{evidence:e(text),speaker:null,kind:'FACT',material:false}],safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false},coverage:[{unitId:'u1',factIds:['f1'],nonFactual:false}],publication:{title:{text,factIds:['f1']},body:[]}};
 const provider=mode==='DIRECT'?new GeminiLanguageProvider('offline',async(_url,init)=>{const request=JSON.parse(String(init?.body));const {publication,...matching}=raw;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(reviewedResponse(request,options.failure?{...matching,action:e('اختلق معلومة')}:matching,{title:publication.title.text,body:'',diagnostics:[]}))}]}}]});}):{id:'fixture',live:false,understand:async(input:{processingMode?:string})=>{assert.equal(input.processingMode,undefined);if(options.failure)throw new ProcessingError('INVALID_EVIDENCE');return f.understanding;},draft:async()=>f.draft,compare:async()=>({relation:'DIFFERENT' as const,rationale:'حدث مختلف',newFactIds:[],conflictingFactIds:[]})};
 // Distinct-city fixture requires the comparison contract, not another extraction response.
 if(mode==='DIRECT'&&options.city)provider.compare=async()=>({relation:'DIFFERENT' as const,rationale:'حدث مختلف',newFactIds:[],conflictingFactIds:[]});
 await processJob(db,job,provider,new AbortController().signal);
 const item=await db.newsItem.findFirst({where:{evidence:{some:{sourcePostId:post.id}}},include});
 const stored=await db.sourcePost.findUniqueOrThrow({where:{id:post.id}});if(!item&&!options.failure&&stored.status!=='DUPLICATE')throw Error('FIXTURE_PROCESSING_FAILED: '+stored.status+' '+stored.error+' '+JSON.stringify(stored.processingResult));
 const policy={version:'telegram-auto-v1' as const,id:randomUUID(),state:'ACTIVE' as const,destination:env.TELEGRAM_CHAT_ID,notBefore:new Date(Date.now()-60000).toISOString(),sourceIds:[source.id],canaryCandidateId:null,authorizedBy:'offline-owner'};
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
 return {source,post,item,policy};
}
async function sent(id:string){const p=await db.publication.findUniqueOrThrow({where:{newsItemId:id},include:{attempts:true}});assert.equal(p.status,'SENT');assert.equal(p.attemptCount,1);assert.equal(p.attempts.length,1);return p;}
for(const [mode,on,number] of [['NORMAL',true,1],['DIRECT',true,2],['NORMAL',false,3],['DIRECT',false,4]] as const)test(`CASE ${number}: ${mode} AUTO ${on?'ON':'OFF'} clean unique`,async()=>{
 const {item,policy}=await make(mode);assert(item);assert.equal(eligibleAutomatic(item,policy),true);assert.equal((item.validationResult as {editorialEligibility:string}).editorialEligibility,'READY_TO_PUBLISH');
 await automaticDeliveryCycle(db,{...env,AUTO_PUBLISH:String(on)},transport);assert.equal(sends,on?1:0);if(on)await sent(item.id);else{assert.equal(await db.publication.count(),0);assert.equal((await db.newsItem.findUniqueOrThrow({where:{id:item.id}})).status,'PENDING_APPROVAL');}
});
for(const [mode,number] of [['NORMAL',5],['DIRECT',6]] as const)test(`CASE ${number}: ${mode} duplicate never republishes`,async()=>{const a=await make(mode);assert(a.item);await automaticDeliveryCycle(db,env,transport);await make(mode,{sourceId:a.source.id});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);assert.equal(await db.sourcePost.count({where:{status:'DUPLICATE'}}),1);assert.equal(await db.publication.count(),1);});
for(const [mode,number] of [['NORMAL',7],['DIRECT',8]] as const)test(`CASE ${number}: ${mode} factual failure cannot publish`,async()=>{const a=await make(mode,{failure:true});assert.equal(a.item,null);await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);assert.equal(await db.publication.count(),0);});
test('CASE 9: saved human edit is not approval',async()=>{const a=await make('NORMAL');assert(a.item);await saveHumanDraft(db,{kind:'news',id:a.item.id,revision:0,title:content,body:'',mediaDecision:true},'offline-editor');await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);});
test('CASE 10: edit after human approval invalidates it and stays manual',async()=>{const a=await make('DIRECT');assert(a.item);const draft=await saveHumanDraft(db,{kind:'news',id:a.item.id,revision:0,title:content,body:'',mediaDecision:true},'offline-editor');const pub=await approveHumanDraft(db,{id:draft.id,digest:humanDigest(draft),confirmed:true},'offline-editor',env);const edited=await saveHumanDraft(db,{kind:'news',id:a.item.id,revision:1,title:content+' اليوم',body:'',mediaDecision:true},'offline-editor');assert.equal(edited.status,'DRAFT');assert.equal(edited.approvedAt,null);assert.equal((await db.publication.findUniqueOrThrow({where:{id:pub.id}})).status,'CANCELLED');await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);});
test('CASE 11: publishing hold blocks delivery',async()=>{await make('NORMAL');await db.appSettings.update({where:{id:1},data:{publishingPaused:true}});assert.equal((await automaticDeliveryCycle(db,env,transport)).status,'PAUSED');assert.equal(sends,0);});
test('CASE 12: excluded TEST cannot use main OR legacy DIRECT entry',async()=>{const a=await make('DIRECT');assert(a.item);await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,sourceIds:['authorized-real-source']}}});await automaticDeliveryCycle(db,env,transport);await publishReadyDirect(db,a.item.id,env,transport);assert.equal(sends,0);assert.equal(await db.publication.count(),0);});
test('CASE 13: concurrent workers create one durable send claim',async()=>{const a=await make('NORMAL');assert(a.item);await Promise.all([automaticDeliveryCycle(db,env,transport),automaticDeliveryCycle(db,env,transport)]);await sent(a.item.id);assert.equal(sends,1);});
test('CASE 14: SENT replay never sends twice',async()=>{await make('DIRECT');await automaticDeliveryCycle(db,env,transport);await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);});
test('CASE 15: publisher restart cannot resend SENT',async()=>{await make('NORMAL');await automaticDeliveryCycle(db,env,transport);const restarted=new PrismaClient({datasourceUrl:url.href});try{await automaticDeliveryCycle(restarted,env,transport);}finally{await restarted.$disconnect();}assert.equal(sends,1);});
test('CASE 16: uncertain acknowledgement closes policy, never retries transport',async()=>{const a=await make('DIRECT');assert(a.item);const uncertain:typeof fetch=async()=>{sends++;throw Error('ACK_LOST');};await automaticDeliveryCycle(db,env,uncertain);const p=await db.publication.findUniqueOrThrow({where:{newsItemId:a.item.id}});assert.equal(p.status,'UNKNOWN');await automaticDeliveryCycle(db,env,uncertain);assert.equal(sends,1);});
test('CASE 17: database runtime AUTO OFF to ON without worker redeploy',async()=>{const a=await make('NORMAL');await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,state:'CLOSED'}}});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:a.policy}});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);});
test('CASE 18: runtime AUTO ON to OFF preserves subsequent clean READY',async()=>{const a=await make('DIRECT');assert(a.item);await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,state:'CLOSED'}}});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);assert.equal((await db.newsItem.findUniqueOrThrow({where:{id:a.item.id}})).status,'PENDING_APPROVAL');assert.equal(await db.publication.count(),0);});
for(const [from,to,number] of [['NORMAL','DIRECT',19],['DIRECT','NORMAL',20]] as const)test(`CASE ${number}: ${from} to ${to} changes processing, not delivery authority`,async()=>{const a=await make(to,{initialMode:from});assert(a.item);assert.equal((a.item.validationResult as {processingMode:string}).processingMode,to);await automaticDeliveryCycle(db,{...env,AUTO_PUBLISH:'false'},transport);assert.equal(sends,0);await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);});
for(const [on,number] of [[true,21],[false,22]] as const)test(`CASE ${number}: SAME clean source fixture under both modes AUTO ${on}`,async()=>{for(const mode of ['NORMAL','DIRECT'] as const){await reset();const a=await make(mode);assert(a.item);await automaticDeliveryCycle(db,{...env,AUTO_PUBLISH:String(on)},transport);assert.equal(sends,on?1:0);if(on)await sent(a.item.id);else assert.equal((a.item.validationResult as {editorialEligibility:string}).editorialEligibility,'READY_TO_PUBLISH');}});
test('later linked duplicate from another source cannot veto or authorize original clean facts',async()=>{const a=await make('NORMAL');assert(a.item);const b=await make('NORMAL');const dup=await db.sourcePost.findUniqueOrThrow({where:{id:b.post.id}});assert.equal(dup.status,'DUPLICATE');assert(await db.newsEvidence.findFirst({where:{newsItemId:a.item.id,sourcePostId:dup.id}}));await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:a.policy}});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);await sent(a.item.id);assert.equal(await db.publication.count(),1);});
test('runtime revocation after freeze is checked again at durable claim; restart preserves pending',async()=>{const a=await make('NORMAL');assert(a.item);const p=await db.$transaction(async tx=>{const pub=await freezeValidatedPublication(tx,{newsItemId:a.item!.id,digest:approvalDigest(a.item!),resolutions:[]},'offline',env,'TELEGRAM',true);return tx.publication.update({where:{id:pub.id},data:{automaticPolicyId:a.policy.id}});});await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,state:'CLOSED'}}});await assert.rejects(publishOne(db,p.id,env,transport),/AUTOMATIC_DELIVERY_DISABLED/);assert.equal(sends,0);assert.equal(await db.publicationAttempt.count(),0);await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:a.policy}});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);});
test('editorial readiness never depends on other process delivery flags',()=>{for(const autoPublish of [true,false])for(const shadowMode of [true,false])for(const requireApproval of [true,false]){assert.equal(editorialDecision({validated:true,review:[{code:'SHADOW_MODE_REVIEW'}]},{autoPublish,shadowMode,requireApproval}).editorialEligibility,'READY_TO_PUBLISH');assert.equal(editorialDecision({validated:true,review:[{code:'UNSUPPORTED_OUTPUT'}]},{autoPublish,shadowMode,requireApproval}).editorialEligibility,'NEEDS_REVIEW');}});
for(const mode of ['NORMAL','DIRECT'] as const)test(mode+' AUTO OFF duplicate does not create publication',async()=>{const a=await make(mode);await make(mode,{sourceId:a.source.id});await automaticDeliveryCycle(db,{...env,AUTO_PUBLISH:'false'},transport);assert.equal(await db.sourcePost.count({where:{status:'DUPLICATE'}}),1);assert.equal(await db.publication.count(),0);assert.equal(sends,0);});
test('simultaneous distinct eligible stories each get one durable delivery',async()=>{const a=await make('NORMAL'),b=await make('NORMAL',{city:'شيراز'});assert(a.item);assert(b.item);assert.notEqual(a.item.eventRevisionId,b.item.eventRevisionId);await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,sourceIds:[a.source.id,b.source.id]}}});await Promise.allSettled([automaticDeliveryCycle(db,env,transport),automaticDeliveryCycle(db,env,transport)]);await automaticDeliveryCycle(db,env,transport);await sent(a.item.id);await sent(b.item.id);assert.equal(sends,2);});
test('a factual failure introduced after freeze is blocked at send claim',async()=>{const a=await make('NORMAL');assert(a.item);const p=await db.$transaction(async tx=>{const pub=await freezeValidatedPublication(tx,{newsItemId:a.item!.id,digest:approvalDigest(a.item!),resolutions:[]},'offline',env,'TELEGRAM',true);return tx.publication.update({where:{id:pub.id},data:{automaticPolicyId:a.policy.id}});});await db.sourcePost.update({where:{id:a.post.id},data:{error:'INVALID_EVIDENCE'}});await assert.rejects(publishOne(db,p.id,env,transport),/AUTOMATIC_AUTHORIZATION_CHANGED/);assert.equal(sends,0);assert.equal(await db.publicationAttempt.count(),0);});

for(const mode of ['NORMAL','DIRECT'] as const)test(mode+' prospective activation blocks historical READY, permits new facts, and rejects backfilled source timestamps',async()=>{
 const a=await make(mode);assert(a.item);
 const boundary=new Date(Date.now()+1).toISOString();
 const policy=reconcileSourceAuthorization({...a.policy,sourceIds:[]},[a.source.id],boundary);
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
 await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);assert.equal(await db.publication.count(),0);
 const newItem=structuredClone(a.item);newItem.createdAt=new Date(boundary);for(const e of newItem.evidence){e.sourcePost.ingestedAt=new Date(boundary);e.sourcePost.sourcePublishedAt=new Date(boundary);}
 assert.equal(eligibleAutomatic(newItem,policy),true);
 newItem.evidence[0].sourcePost.sourcePublishedAt=new Date(new Date(boundary).getTime()-1);assert.equal(eligibleAutomatic(newItem,policy),false);
 const fresh=await make(mode,{sourceId:a.source.id,city:'شيراز'});assert(fresh.item);await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);await sent(fresh.item.id);assert.equal((await db.newsItem.findUniqueOrThrow({where:{id:a.item.id}})).status,'PENDING_APPROVAL');
});
test('source disabled after freeze cannot claim; re-enable cannot send its historical pending revision',async()=>{
 const a=await make('DIRECT');assert(a.item);const p=await db.$transaction(async tx=>{const p=await freezeValidatedPublication(tx,{newsItemId:a.item!.id,digest:approvalDigest(a.item!),resolutions:[]},'offline',env,'TELEGRAM',true);return tx.publication.update({where:{id:p.id},data:{automaticPolicyId:a.policy.id}});});
 await changeSource(db,a.source.id,'disable','offline');await assert.rejects(publishOne(db,p.id,env,transport),/AUTOMATIC_AUTHORIZATION_CHANGED/);
 await changeSource(db,a.source.id,'enable','offline');await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);assert.equal(await db.publicationAttempt.count(),0);
});

// Publisher must consume acceptance, never repeat editorial selection.
test('accepted NORMAL receipt stays eligible despite later soft classification metadata and source identity',async()=>{
 const a=await make('NORMAL');assert(a.item);const item=structuredClone(a.item);
 for(const link of item.evidence){
  const post=link.sourcePost, result=post.processingResult as Record<string,unknown>;
  assert.equal((result.acceptance as {accepted:boolean}).accepted,true);
  const extraction=result.extraction as Record<string,unknown>;extraction.priority='P4';extraction.filterReason='OPINION';extraction.relevance='UNCERTAIN';
  post.relevance='UNCERTAIN';post.source.editorialProfile={...official,verified:false,flagged:true,classification:'WESTERN'};
 }
 assert.equal(eligibleAutomatic(item,a.policy),true);
 (item.evidence[0].sourcePost.processingResult as Record<string,unknown>).acceptance={version:'iran-acceptance-v1',mode:'NORMAL',accepted:false};
 assert.equal(eligibleAutomatic(item,a.policy),false);
});

test('MODE 1 AUTO stable acknowledged sends accepted machine item once',async()=>{const a=await make('NORMAL');assert(a.item);await automaticDeliveryCycle(db,env,transport,undefined,`${a.policy.id}:ACTIVE`);assert.equal(sends,1);await sent(a.item.id);});
test('MODE 2 MANUAL stable keeps accepted item in Approvals',async()=>{const a=await make('NORMAL');assert(a.item);await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,state:'CLOSED'}}});await automaticDeliveryCycle(db,env,transport,undefined,`${a.policy.id}:CLOSED`);assert.equal(sends,0);assert.equal((await db.newsItem.findUniqueOrThrow({where:{id:a.item.id}})).status,'PENDING_APPROVAL');});
test('MODE 3 new AUTO request without matching acknowledgement cannot claim',async()=>{const a=await make('NORMAL');const r=await automaticDeliveryCycle(db,env,transport,undefined,`${randomUUID()}:CLOSED`);assert.equal(r.status,'AWAITING_POLICY_ACKNOWLEDGEMENT');assert.equal(sends,0);assert.equal(await db.publication.count(),0);assert(a.item);});
test('MODE 4 MANUAL request revokes immediately even before worker acknowledgement',async()=>{const a=await make('NORMAL');await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,id:randomUUID(),state:'CLOSED'}}});assert.equal((await automaticDeliveryCycle(db,env,transport,undefined,`${a.policy.id}:ACTIVE`)).status,'DISABLED');assert.equal(sends,0);});
test('MODE 5 switch before claim blocks frozen automatic publication',async()=>{const a=await make('NORMAL');assert(a.item);const p=await db.$transaction(async tx=>{const frozen=await freezeValidatedPublication(tx,{newsItemId:a.item!.id,digest:approvalDigest(a.item!),resolutions:[]},'automatic-telegram-worker',env,'TELEGRAM',true);return tx.publication.update({where:{id:frozen.id},data:{automaticPolicyId:a.policy.id}});});await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,state:'CLOSED'}}});await assert.rejects(publishOne(db,p.id,env,transport),/AUTOMATIC_DELIVERY_DISABLED/);assert.equal(sends,0);assert.equal(await db.publicationAttempt.count(),0);});
test('MODE 6 stale revision at claim is rejected without transport',async()=>{const a=await make('NORMAL');assert(a.item);const p=await db.$transaction(async tx=>{const frozen=await freezeValidatedPublication(tx,{newsItemId:a.item!.id,digest:approvalDigest(a.item!),resolutions:[]},'automatic-telegram-worker',env,'TELEGRAM',true);return tx.publication.update({where:{id:frozen.id},data:{automaticPolicyId:a.policy.id}});});await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,id:randomUUID()}}});await assert.rejects(publishOne(db,p.id,env,transport),/AUTOMATIC_AUTHORIZATION_CHANGED/);assert.equal(sends,0);});
test('MODE 7 new enable boundary does not drain old manual backlog',async()=>{const a=await make('NORMAL');assert(a.item);const boundary=new Date(Date.now()+1).toISOString();await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,id:randomUUID(),notBefore:boundary}}});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);assert.equal((await db.newsItem.findUniqueOrThrow({where:{id:a.item.id}})).status,'PENDING_APPROVAL');});
test('MODE 8 SENT stays immutable across OFF ON revisions',async()=>{const a=await make('NORMAL');assert(a.item);await automaticDeliveryCycle(db,env,transport);const before=await sent(a.item.id);for(const state of ['CLOSED','ACTIVE'] as const){await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,id:randomUUID(),state}}});await automaticDeliveryCycle(db,env,transport);}assert.equal(sends,1);assert.deepEqual(await sent(a.item.id),before);});
for(const [number,status] of [[9,'FAILED'],[10,'NEEDS_REVIEW'],[11,'FILTERED'],[12,'DUPLICATE']] as const)test(`MODE ${number} ${status} is never converted by a policy switch`,async()=>{const a=await make('NORMAL');assert(a.item);await db.newsItem.update({where:{id:a.item.id},data:{status}});for(const state of ['CLOSED','ACTIVE'] as const){await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,state}}});await automaticDeliveryCycle(db,env,transport);}assert.equal(sends,0);assert.equal((await db.newsItem.findUniqueOrThrow({where:{id:a.item.id}})).status,status);});
test('MODE 13 human editing never becomes unattended approval',async()=>{const a=await make('NORMAL');assert(a.item);await saveHumanDraft(db,{kind:'news',id:a.item.id,revision:0,title:content,body:'',mediaDecision:true},'offline-editor');await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);assert.equal(await db.publication.count(),0);});
test('MODE 14 processing result survives mode changes before final delivery',async()=>{const a=await make('DIRECT');assert(a.item);const before=await db.sourcePost.findUniqueOrThrow({where:{id:a.post.id}});await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,state:'CLOSED'}}});await automaticDeliveryCycle(db,env,transport);assert.deepEqual(await db.sourcePost.findUniqueOrThrow({where:{id:a.post.id}}),before);assert.equal(sends,0);});
test('MODE 15 Emergency Stop independent of AUTO revision',async()=>{const a=await make('NORMAL');await db.appSettings.update({where:{id:1},data:{publishingPaused:true}});assert.equal((await automaticDeliveryCycle(db,env,transport,undefined,`${a.policy.id}:ACTIVE`)).status,'PAUSED');assert.equal(sends,0);});
test('MODE 16 explicit approved publication remains deliverable in MANUAL exactly once',async()=>{const a=await make('NORMAL');assert(a.item);await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,state:'CLOSED'}}});const p=await db.$transaction(tx=>freezeValidatedPublication(tx,{newsItemId:a.item!.id,digest:approvalDigest(a.item!),resolutions:[]},'offline-human',env,'TELEGRAM'));assert.equal(p.automaticPolicyId,null);await publishOne(db,p.id,env,transport);await publishOne(db,p.id,env,transport);assert.equal(sends,1);await sent(a.item.id);});

test('MODE audit: committed claim is the point of no return; later OFF cannot retract it',async()=>{
 const a=await make('NORMAL');assert(a.item);
 const p=await db.$transaction(async tx=>{const frozen=await freezeValidatedPublication(tx,{newsItemId:a.item!.id,digest:approvalDigest(a.item!),resolutions:[]},'automatic-telegram-worker',env,'TELEGRAM',true);return tx.publication.update({where:{id:frozen.id},data:{automaticPolicyId:a.policy.id}});});
 let flipped=false;
 const intercepted=new Proxy(db,{get(target,key){if(key==='$transaction')return async(...args:unknown[])=>{
  const value=await Reflect.apply(target.$transaction,target,args);
  if(!flipped&&(await db.publication.findUniqueOrThrow({where:{id:p.id}})).status==='SENDING'){
   flipped=true;await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...a.policy,id:randomUUID(),state:'CLOSED'}}});
  }
  return value;
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await publishOne(intercepted,p.id,env,transport);assert(flipped);assert.equal(sends,1);await sent(a.item.id);
 await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);
});

// Regression for NORMAL publication facts (current receipt) versus event history.
async function asMaterialUpdate(a:Awaited<ReturnType<typeof make>>){
 assert(a.item);
 const event=structuredClone(a.item.eventRevision.facts) as unknown as Record<string,unknown>;
 const facts=structuredClone(a.item.factualEvidence) as unknown as Record<string,unknown>[];
 const historical={...facts[0],key:'previous-independent-fact',evidence:{...Object(facts[0].evidence),sourcePostId:'historical-source-post'}};
 await db.eventRevision.update({where:{id:a.item.eventRevisionId},data:{facts:jsonValue({...event,facts:[historical,...facts]}),materialChange:'current update'}});
 const post=await db.sourcePost.findUniqueOrThrow({where:{id:a.post.id}});
 await db.sourcePost.update({where:{id:post.id},data:{processingResult:jsonValue({...Object(post.processingResult),classification:'MATERIAL_UPDATE'})}});
 await db.eventMatch.updateMany({where:{sourcePostId:post.id,eventRevisionId:a.item.eventRevisionId},data:{classification:'MATERIAL_UPDATE'}});
 await db.newsItem.update({where:{id:a.item.id},data:{validationResult:jsonValue({...Object(a.item.validationResult),format:'UPDATE'})}});
 return db.newsItem.findUniqueOrThrow({where:{id:a.item.id},include});
}
function jsonValue(value:unknown):Prisma.InputJsonValue{return JSON.parse(JSON.stringify(value));}
async function freezeManually(id:string){const item=await db.newsItem.findUniqueOrThrow({where:{id},include});return db.$transaction(tx=>freezeValidatedPublication(tx,{newsItemId:id,digest:approvalDigest(item),resolutions:[]},'offline-human',env));}
test('FREEZE A NORMAL update freezes only complete unchanged current evidence; historical ID collisions are harmless',async()=>{
 const a=await make('NORMAL'),item=await asMaterialUpdate(a);assert(eligibleAutomatic(item,a.policy));
 const pub=await freezeManually(item.id);assert.equal(pub.contentSnapshot,publicationText(item));assert.equal(pub.attemptCount,0);assert.equal(sends,0);
});
for(const mutation of ['current-change','current-remove','revision-remove','receipt-change'] as const)test('FREEZE B required evidence '+mutation+' remains rejected',async()=>{
 const a=await make('NORMAL'),item=await asMaterialUpdate(a);
 if(mutation==='current-change')await db.newsItem.update({where:{id:item.id},data:{factualEvidence:jsonValue((item.factualEvidence as Prisma.JsonArray).map(f=>({...Object(f),key:'changed'})))}});
 if(mutation==='current-remove')await db.newsItem.update({where:{id:item.id},data:{factualEvidence:[]}});
 if(mutation==='revision-remove')await db.eventRevision.update({where:{id:item.eventRevisionId},data:{facts:jsonValue({...Object(item.eventRevision.facts),facts:[]})}});
 if(mutation==='receipt-change'){const p=await db.sourcePost.findUniqueOrThrow({where:{id:a.post.id}});const r=JSON.parse(JSON.stringify(p.processingResult));r.extraction.event.facts[0].key='changed';await db.sourcePost.update({where:{id:p.id},data:{processingResult:r}});}
 const changed=await db.newsItem.findUniqueOrThrow({where:{id:item.id},include});assert.equal(eligibleAutomatic(changed,a.policy),false);
 await assert.rejects(freezeManually(item.id),/FACT_EVIDENCE_CHANGED/);assert.equal(await db.publication.count(),0);assert.equal(sends,0);
});
test('FREEZE C NEW_EVENT still requires full equality',async()=>{
 const a=await make('NORMAL');assert(a.item);const revision=Object(a.item.eventRevision.facts);await db.eventRevision.update({where:{id:a.item.eventRevisionId},data:{facts:jsonValue({...revision,facts:[...revision.facts,{...revision.facts[0],key:'extra'}]})}});
 await assert.rejects(freezeManually(a.item.id),/FACT_EVIDENCE_CHANGED/);
 await db.eventRevision.update({where:{id:a.item.eventRevisionId},data:{facts:jsonValue(a.item.eventRevision.facts)}});await freezeManually(a.item.id);assert.equal(sends,0);
});
test('FREEZE D DIRECT update keeps existing source receipt invariant',async()=>{
 const a=await make('DIRECT'),item=await asMaterialUpdate(a);assert(eligibleAutomatic(item,a.policy));await freezeManually(item.id);assert.equal(sends,0);
});
test('FREEZE E/F blocked head is audited once; valid successor sends once across subsequent/concurrent cycles',async()=>{
 const a=await make('NORMAL');assert(a.item);
 const b=await make('NORMAL',{city:'شيراز'});assert(b.item);
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...b.policy,sourceIds:[a.source.id,b.source.id]}}});
 await db.eventRevision.update({where:{id:a.item.eventRevisionId},data:{facts:jsonValue({...Object(a.item.eventRevision.facts),facts:[]})}});
 assert(eligibleAutomatic(await db.newsItem.findUniqueOrThrow({where:{id:a.item.id},include}),{...b.policy,sourceIds:[a.source.id,b.source.id]}));
 await automaticDeliveryCycle(db,env,transport);
 const blocked=await db.newsItem.findUniqueOrThrow({where:{id:a.item.id}});assert.equal(blocked.status,'NEEDS_REVIEW');assert.equal(blocked.error,'FACT_EVIDENCE_CHANGED');assert.equal(await db.publication.count({where:{newsItemId:a.item.id}}),0);
 assert.equal(workflowState(blocked),'NEEDS_REVIEW');assert((await newsPage(db,'review',1)).items.some(n=>n.id===a.item!.id));assert(!(await newsPage(db,'approval',1)).items.some(n=>n.id===a.item!.id));const audit=await db.auditLog.findFirstOrThrow({where:{entityId:a.item.id,action:'AUTOMATIC_PUBLICATION_BLOCKED'}});assert.deepEqual(Object(audit.metadata).priorValidationResult,a.item.validationResult);assert.deepEqual(blocked.factualEvidence,a.item.factualEvidence);
 assert.equal(await db.auditLog.count({where:{entityId:a.item.id,action:'AUTOMATIC_PUBLICATION_BLOCKED'}}),1);await sent(b.item.id);assert.equal(sends,1);
 await Promise.all([automaticDeliveryCycle(db,env,transport),automaticDeliveryCycle(db,env,transport)]);
 assert.equal(sends,1);assert.equal(await db.publicationAttempt.count(),1);assert.equal(await db.auditLog.count({where:{entityId:a.item.id,action:'AUTOMATIC_PUBLICATION_BLOCKED'}}),1);
});

test('FREEZE NORMAL material update follows automatic durable claim once, without human approval',async()=>{
 const a=await make('NORMAL'),item=await asMaterialUpdate(a);await automaticDeliveryCycle(db,env,transport);const p=await sent(item.id);assert.equal(p.automaticPolicyId,a.policy.id);assert.equal(sends,1);
 assert.equal((await db.newsItem.findUniqueOrThrow({where:{id:item.id}})).approvedBy,'automatic-telegram-worker');await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);
});
