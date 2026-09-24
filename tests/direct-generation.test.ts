import {supportedLedger} from './fixtures/fidelity-review';
import {renderingChecks} from '../src/lib/processing/rendering-contract';
import {publicationUnits} from '../src/lib/processing/direct-publication';
import {duplicatePage,outcomePage} from '../src/lib/processing-visibility';
import {checkpointProvider,type CheckpointStore} from '../src/worker/checkpoints';
import {matchEvent,type Candidate} from '../src/lib/processing/matcher';
import {approvePublication,approvalDigest} from '../src/lib/telegram/publisher';
import {unresolvedWhere} from '../src/lib/dashboard-pagination';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {directMatchingUnderstanding,completeDirectGeneration,directFinalArticle} from '../src/lib/processing/direct-generation';
import {editorialContract,EDITORIAL_CONTRACT_SHA256} from '../src/lib/processing/editorial-contract';
import {unknownProfile,validateUnderstanding} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {publicationReady,publicationCandidateInclude} from '../src/lib/telegram/publication-policy';
import {automaticDeliveryCycle} from '../src/lib/telegram/automatic-delivery';
import {editorialDecision} from '../src/lib/processing/editorial-eligibility';
const signal=()=>new AbortController().signal;
const safety={filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false};
const sources={ar:'افتتح المجلس مدرسة جديدة.',fa:'شورای شهر مدرسه جدیدی افتتاح کرد.',en:'The council opened a new school.'};
function extraction(source:string){return {coverage:publicationUnits(source).map(u=>({unitId:u.id,nonFactual:false,factIds:['f1']})),actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:source,context:source},speaker:null,kind:'FACT',material:false}],safety};}
const article={title:'إيران الآن | افتتاح مدرسة جديدة',body:'افتتح المجلس مدرسة جديدة.',diagnostics:[] as string[]};
const envelope=(raw:unknown)=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,thoughtsTokenCount:0}});
function reviewed(article:{body:string}){return {review:['title',...(article.body?['body:1']:[])].map(id=>({id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[],comparisons:[]};}
function provider(source:string,diagnostics:string[]=[],calls:string[]=[]){return new GeminiLanguageProvider('offline',async(_url,init)=>{
 const request=JSON.parse(String(init?.body));const schema=request.generationConfig.responseJsonSchema;
 assert.equal(request.systemInstruction.parts[0].text.split(editorialContract).length,2);
 if(schema.properties.extraction){calls.push('combined');return envelope({extraction:{...extraction(source),relevance:'POLITICAL_NEWS',contentType:'NEWS',contentTypeEvidence:{excerpt:source,context:source}},article:{...article,diagnostics}});}
 calls.push('independent');const data=JSON.parse(request.contents[0].parts[0].text);assert.equal(data.originalSource,source);assert.equal(data.validatedEvidence.facts[0].evidence.excerpt,source);
 return envelope({...reviewed(article),fidelityLedger:supportedLedger(source,data.publication)});
});}
for(const [language,source] of Object.entries(sources))test(`DIRECT ${language}: combined canonical generation then independent semantic review`,async()=>{
 const calls:string[]=[];const p=provider(source,[],calls);const u=validateUnderstanding(await p.understand({content:source,processingMode:'DIRECT',publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},signal()),source);
 assert.equal(u.directGeneration?.version,'direct-generation-v3');
 await p.draft({content:source,processingMode:'DIRECT',understanding:u,rules:ruleSet},signal());
 const final=directFinalArticle(source,u);assert.equal(final.title,article.title);assert.deepEqual(calls,['combined','independent']);assert.equal(u.directGeneration?.semanticVerification,'INDEPENDENT');assert.equal(u.directGeneration?.editorialContractHash,EDITORIAL_CONTRACT_SHA256);
});
test('DIRECT material update freezes only current evidence; uncertain match and exhausted lease stay out of editorial review',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
 const src=await db.source.create({data:{platform:'TELEGRAM',handle:'updateoffline',name:'offline update',url:'https://t.me/updateoffline',processingMode:'DIRECT'}});
 async function run(content:string,uncertain=false){
  const post=await ingest(db,src.id,{externalId:String(Date.now()),url:src.url+'/1',content,publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});
  const job=await claimJob(db,'update',new Date(),false,(await db.processingJob.findMany({where:{sourcePostId:{not:post.id}},select:{sourcePostId:true}})).map(j=>j.sourcePostId));assert.ok(job);
  const e=(excerpt:string)=>({excerpt,context:content});const raw={...extraction(content),actors:[e('اللجنة')],action:e('افتتحت'),object:e('مدرسة'),statements:[{evidence:e(content),speaker:null,kind:'DECISION',material:true}]};
  const p=new GeminiLanguageProvider('offline',async(_url,init)=>{const request=JSON.parse(String(init?.body)),schema=request.generationConfig.responseJsonSchema,data=JSON.parse(request.contents[0].parts[0].text);return envelope(schema.properties.extraction?{extraction:raw,article:{title:'إيران الآن | '+content,body:'',diagnostics:[]}}:{...reviewed({body:''}),comparisons:data.comparisons.map((c:{id:string})=>({id:c.id,decision:{relation:uncertain?'UNCERTAIN':'SAME',newFactIds:['f1'],conflictingFactIds:[],rationale:'تحديث في الخبر'}}))});});
  p.compare=async()=>{throw new Error('UNEXPECTED_THIRD_CALL');};
  await processJob(db,job,p,signal());return post;
 }
 await run('افتتحت اللجنة مدرسة.');const update=await run('افتتحت اللجنة مدرسة وقررت توسعتها.');
 const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:update.id}}},include:publicationCandidateInclude});assert.equal(publicationReady(item),true);assert.equal(item.eventRevision.revision,2);
 const frozen=await approvePublication(db,{newsItemId:item.id,digest:approvalDigest(item),resolutions:[]},'offline-editor',{TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123'});assert.equal(frozen.status,'PENDING');assert.equal(frozen.attemptCount,0);assert.equal(frozen.contentSnapshot,item.title);
 const uncertain=await run('افتتحت اللجنة مدرسة وتدرس توسعتها.',true);const held=await db.sourcePost.findUniqueOrThrow({where:{id:uncertain.id}});assert.equal(held.status,'FAILED');assert.equal(Object(held.processingResult).editorialEligibility,'MATCHING_HOLD');assert.equal(await db.sourcePost.count({where:{AND:[unresolvedWhere,{id:held.id}]}}),0);
 const expired=await ingest(db,src.id,{externalId:'lease',url:src.url+'/lease',content:'نص لا يُعالج',publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:expired.id},data:{status:'RUNNING',attemptCount:5,maxAttempts:5,lockedAt:new Date(0),lockedBy:'dead'}});await claimJob(db,'recover');assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:expired.id}})).status,'FAILED');
 }finally{await db.$disconnect();}
});
for(const diagnostic of ['UNCERTAIN_SCOPE','SELECTION_CONFIDENCE','AI_CONFIDENCE','DIRECT_MATERIAL_COVERAGE_FAILED','SPEAKER_ATTRIBUTION_MISMATCH','TRANSLATION_CONFIDENCE','FORMAT_REVIEW','CANONICAL_DIAGNOSTIC'])test(`${diagnostic} is retained without a human-review receipt`,()=>{
 const u=directMatchingUnderstanding(extraction(sources.ar),sources.ar);const output=completeDirectGeneration({...article,diagnostics:[diagnostic]},sources.ar,u);assert.equal(output.review[0].detail,diagnostic);assert.equal(u.directGeneration?.semanticVerification,'DIAGNOSTIC_ONLY');
});
test('punctuation, source binding, frozen wording and contract hash',()=>{
 const u=directMatchingUnderstanding(extraction(sources.ar),sources.ar);assert.equal(completeDirectGeneration({...article,body:'افتتح المجلس مدرسة جديدة'},sources.ar,u).body,article.body);
 assert.throws(()=>directFinalArticle(sources.ar+'x',u),/RECEIPT_CHANGED/);
 u.directGeneration!.editorialContractHash='changed';assert.throws(()=>directFinalArticle(sources.ar,u),/RECEIPT_CHANGED/);
});
for(const raw of [{...article,title:''},{...article,body:'\u0000'},{...article,title:'English only'},null])test('empty/corrupt/malformed output never receives a generation receipt '+JSON.stringify(raw),()=>{
 const u=directMatchingUnderstanding(extraction(sources.ar),sources.ar);assert.throws(()=>completeDirectGeneration(raw,sources.ar,u));assert.equal(u.directGeneration,undefined);
});
test('matching evidence failure is explicit and cannot be declared unique',()=>{
 assert.throws(()=>directMatchingUnderstanding({...extraction(sources.ar),statements:[]},sources.ar),/DIRECT_MATCH_INPUT_INVALID/);
});
test('NORMAL factual errors still require review; canonical file is unchanged',()=>{
 assert.equal(editorialDecision({error:'UNSUPPORTED_OUTPUT'},{autoPublish:true,shadowMode:false,requireApproval:true}).editorialEligibility,'NEEDS_REVIEW');
 assert.equal(readFileSync('config/editorial/iran-now-contract.txt','utf8'),editorialContract);
});
test('restart restores the completed article receipt without another provider call',async()=>{
 const records=new Map<string,{output:unknown}|{pending:true}>();const store:CheckpointStore={load:async k=>records.get(k)??null,start:async k=>{records.set(k,{pending:true});},finish:async(k,v)=>{records.set(k,{output:structuredClone(v)});}};
 const calls:string[]=[];const input={processingMode:'DIRECT' as const,content:sources.ar,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet};
 for(let i=0;i<2;i++){
  const p=checkpointProvider(provider(sources.ar,[],calls),store);const u=validateUnderstanding(await p.understand(input,signal()),sources.ar);
  const output=await p.draft({processingMode:'DIRECT',content:sources.ar,understanding:u,rules:ruleSet},signal()) as ReturnType<typeof directFinalArticle>;
  u.directGeneration=output.generationReceipt;assert.equal(directFinalArticle(sources.ar,u).title,article.title);
 }
 assert.deepEqual(calls,['combined','independent']);
});
test('DIRECT material update uses literal source evidence, never independent-truth flag',async()=>{
 const source='قرر المجلس فتح مدرسة جديدة.';const raw=extraction(source);raw.actors=[{excerpt:'المجلس',context:source}] as never[];
 const u=directMatchingUnderstanding(raw,source);u.event.action={key:'open',arabic:'فتح',evidence:{excerpt:'فتح',start:source.indexOf('فتح'),end:source.indexOf('فتح')+3}};u.event.object={key:'school',arabic:'مدرسة',evidence:{excerpt:'مدرسة',start:source.indexOf('مدرسة'),end:source.indexOf('مدرسة')+5}};u.event.facts[0].kind='DECISION';u.event.facts[0].material=true;
 const previous=structuredClone(u.event);previous.facts[0].key='earlier-plan';
 const c:Candidate={id:'event',revisionId:'r',revision:1,publishedAt:new Date(),published:true,data:previous};
 const p=provider(source);p.compare=async()=>({relation:'SAME',newFactIds:['f1'],conflictingFactIds:[],rationale:'تحديث في القرار',identity:{basis:'SAME_OCCURRENCE',incomingFactIds:['f1'],existingFactIds:['f1'],explanation:'Fixture grounded update of same event'}});
 assert.equal((await matchEvent(u.event,new Date(),[c],p,signal(),{source,understanding:u,processingMode:'DIRECT'})).classification,'MATERIAL_UPDATE');assert.equal(u.event.facts[0].verified,false);
 p.compare=async()=>({relation:'UNCERTAIN',newFactIds:[],conflictingFactIds:[],rationale:'تعذر حسم التطابق'});
 assert.equal((await matchEvent(u.event,new Date(),[c],p,signal(),{source,understanding:u,processingMode:'DIRECT'})).classification,'UNCERTAIN_MATCH');
});
test('real processor + existing publisher: DIRECT diagnostics READY, manual OFF, auto ON, immutable receipt, duplicate prevention and technical failure',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
 const src=await db.source.create({data:{platform:'TELEGRAM',handle:'directv2offline',name:'Direct v2 offline',url:'https://t.me/directv2offline',enabled:true,processingMode:'DIRECT'}});
 const post=await ingest(db,src.id,{externalId:'1',url:src.url+'/1',content:sources.ar,publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});
 const job=await claimJob(db,'offline');assert.ok(job);assert.ok(!('error' in await processJob(db,job,provider(sources.ar,['DIRECT_MATERIAL_COVERAGE_FAILED','SPEAKER_ATTRIBUTION_MISMATCH']),signal())));
 const stored=await db.sourcePost.findUniqueOrThrow({where:{id:post.id}});assert.equal(stored.status,'PENDING_APPROVAL');
 const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:post.id}}},include:publicationCandidateInclude});assert.equal(item.status,'PENDING_APPROVAL');assert.equal(publicationReady(item),true);assert.equal(Object(item.validationResult).semanticVerification,'INDEPENDENT');assert.equal(Object(item.validationResult).editorialEligibility,'READY_TO_PUBLISH');
 assert.equal(publicationReady({...item,title:item.title+' altered'}),false);assert.equal(publicationReady({...item,humanDraft:{id:'human'} as NonNullable<typeof item.humanDraft>}),false);
 const env={AUTO_PUBLISH:'true',SHADOW_MODE:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123'};
 let sends=0;const transport:typeof fetch=async()=>{sends++;return Response.json({ok:true,result:{message_id:91,chat:{id:-100123}}});};
 await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{version:'telegram-auto-v1',id:'11111111-1111-4111-8111-111111111111',state:'ACTIVE',destination:'-100123',notBefore:new Date(0).toISOString(),sourceIds:[src.id],canaryCandidateId:null,authorizedBy:'offline'}}});
 await db.appSettings.update({where:{id:1},data:{publishingPaused:true}});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);await db.appSettings.update({where:{id:1},data:{publishingPaused:false}});
 await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);
 const duplicate=await ingest(db,src.id,{externalId:'2',url:src.url+'/2',content:sources.ar,publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:duplicate.id},data:{availableAt:new Date(0)}});const duplicateJob=await claimJob(db,'duplicate');assert.ok(duplicateJob);await processJob(db,duplicateJob,provider('MUST_NOT_CALL'),signal());assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:duplicate.id}})).status,'DUPLICATE');
 const visible=await duplicatePage(db,1);const match=visible.items.find(m=>m.sourcePostId===duplicate.id);assert.ok(match);assert.equal(match.sourcePost.source.id,src.id);assert.equal(match.eventRevision.newsItem?.id,item.id);assert.equal(await db.newsItem.count({where:{evidence:{some:{sourcePostId:duplicate.id}}}}),0);assert.equal((await outcomePage(db,{post:duplicate.id,state:'review'},1)).total,0);assert.equal((await outcomePage(db,{post:duplicate.id,state:'ready'},1)).total,0);
 const restarted=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});try{assert((await duplicatePage(restarted,1)).items.some(m=>m.id===match.id));}finally{await restarted.$disconnect();}await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);
 const failed=await ingest(db,src.id,{externalId:'3',url:src.url+'/3',content:'نص مختلف',publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:failed.id},data:{availableAt:new Date(0)}});const failedJob=await claimJob(db,'failure');assert.ok(failedJob);await processJob(db,failedJob,new GeminiLanguageProvider('offline',async()=>new Response('{}',{status:503})),signal());const failure=await db.sourcePost.findUniqueOrThrow({where:{id:failed.id}});assert.equal(failure.status,'FAILED');assert.equal(Object(failure.processingResult).editorialEligibility,'PROCESSING_ERROR');assert.equal(await db.publication.count({where:{newsItemId:item.id}}),1);
 }finally{await db.$disconnect();}
});
for(const language of ['fa','en'] as const)test(`persisted DIRECT ${language} candidate reaches Approvals after independent semantic review`,{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/direct_/);
 const db=new PrismaClient({datasourceUrl:url.href});
 try{
  await db.$executeRawUnsafe('TRUNCATE TABLE "Source", "CanonicalEvent", "AuditLog" CASCADE');
  const src=await db.source.create({data:{platform:'TELEGRAM',handle:'language_'+language,name:'offline',url:'https://t.me/offline',processingMode:'DIRECT'}});
  const post=await ingest(db,src.id,{externalId:'1',url:src.url+'/1',content:sources[language],publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});
  const job=await claimJob(db,'language');assert.ok(job);await processJob(db,job,provider(sources[language],['TRANSLATION_CONFIDENCE']),signal());
  const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:post.id}}},include:publicationCandidateInclude});assert.equal(item.status,'PENDING_APPROVAL');assert.equal(Object(item.validationResult).editorialEligibility,'READY_TO_PUBLISH');assert.deepEqual(item.needsReviewReasons,[]);assert.equal(publicationReady(item),true);assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});
test('database commit failure rolls back candidate and uses technical recovery, never READY',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
 const src=await db.source.create({data:{platform:'TELEGRAM',handle:'dbfailureoffline',name:'offline',url:'https://t.me/offline',processingMode:'DIRECT'}});
 const post=await ingest(db,src.id,{externalId:'1',url:src.url+'/1',content:sources.ar,publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});const job=await claimJob(db,'dbfailure');assert.ok(job);
 const failing=db.$extends({query:{newsItem:{create:async()=>{throw new Error('OFFLINE_DATABASE_FAILURE');}}}});
 await processJob(failing as unknown as PrismaClient,job,provider(sources.ar),signal());const saved=await db.sourcePost.findUniqueOrThrow({where:{id:post.id}});assert.equal(saved.status,'FAILED');assert.equal(Object(saved.processingResult).editorialEligibility,'PROCESSING_ERROR');assert.equal(await db.newsItem.count({where:{evidence:{some:{sourcePostId:post.id}}}}),0);
 }finally{await db.$disconnect();}
});
