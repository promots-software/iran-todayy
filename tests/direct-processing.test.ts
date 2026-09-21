import {bilingualFixture,passingReview} from './fixtures/direct-bilingual';
import {prepareDirectBilingual} from '../src/lib/processing/direct-bilingual';
import {publishReadyDirect,assertDirectAutoEnabled,eligibleDirectPublication} from '../src/lib/telegram/direct-auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {saveSource,changeSourceProcessingMode} from '../src/lib/source-service';
import {sourceSchema} from '../src/lib/domain';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {validateDirectExtraction,adaptDirectExtraction} from '../src/lib/processing/direct';
import {unknownProfile,validateUnderstanding,ProcessingError} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {finalizeConstrainedDraft} from '../src/lib/processing/local-finalization';
import {editorialDecision} from '../src/lib/processing/editorial-eligibility';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {assertRole} from '../src/lib/dashboard-permissions';
const source='افتتح المجلس مدرسة جديدة في العاصمة.';
const ev=(excerpt:string,context=source)=>({excerpt,context});
const safety={filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false};
const raw=()=>({actors:[ev('المجلس')],action:ev('افتتح'),object:ev('مدرسة جديدة'),location:ev('العاصمة'),event_time:null,statements:[{evidence:ev(source),speaker:null,kind:'FACT',material:false}],safety});
const publicationRaw=()=>({...raw(),coverage:[{unitId:'u1',factIds:['f1'],nonFactual:false}],publication:{title:{text:source.slice(0,-1),factIds:['f1']},body:[]}});
const input=(content=source)=>({content,processingMode:'DIRECT' as const,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet});
const signal=()=>new AbortController().signal;
const response=(output:unknown)=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:100,thoughtsTokenCount:0}});
test('source mode defaults NORMAL, accepts explicit modes only, ADMIN server action and UI',()=>{
 assert.equal(sourceSchema.parse({platform:'X',handle:'example',name:'test'}).processingMode,'NORMAL');
 assert.throws(()=>sourceSchema.parse({platform:'X',handle:'example',name:'test',processingMode:'AUTO'}));
 assert.throws(()=>assertRole('EDITOR',true));assert.doesNotThrow(()=>assertRole('ADMIN',true));
 const action=readFileSync('src/app/actions.ts','utf8').split('export async function sourceProcessingModeAction')[1];assert.ok(action.includes('await actor(true)'));
 const ui=readFileSync('src/components/source-processing-mode.tsx','utf8');for(const text of ['طريقة المعالجة','المعالجة العادية','المعالجة المباشرة','name="processingMode"'])assert.ok(ui.includes(text));
 const migration=readFileSync('prisma/migrations/20260921160000_source_processing_mode/migration.sql','utf8');assert.match(migration,/DEFAULT 'NORMAL'/);assert.doesNotMatch(migration,/DROP|DELETE|UPDATE /);
});
test('Arabic DIRECT one factual request, no relevance/topic decision, local grounded draft',async()=>{
 let calls=0;const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{calls++;const req=JSON.parse(String(init?.body));const schema=req.generationConfig.responseJsonSchema;assert.equal(schema.properties.relevance,undefined);assert.equal(schema.properties.topic,undefined);assert.ok(!req.systemInstruction.parts[0].text.includes('six-geographies-v1'));return response(publicationRaw());});
 const u=validateUnderstanding(await provider.understand(input(),signal()),source);
 assert.equal(u.relevance,'POLITICAL_NEWS');assert.equal(u.topic,'UNKNOWN');
 const draft=await provider.draft({content:source,understanding:u,rules:ruleSet},signal());
 const final=finalizeConstrainedDraft(draft,source,u,unknownProfile);assert.ok(final.title.includes('مدرسة'));assert.ok(!final.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'));assert.equal(calls,1);
});
test('Persian DIRECT uses combined generation and independent review only',async()=>{
 const {source:fa,raw}=bilingualFixture();let calls=0;
 const provider=new GeminiLanguageProvider('offline',async()=>{calls++;if(calls===1)return response(raw);if(calls===2)return response(passingReview(fa,prepareDirectBilingual(raw,fa)));throw Error('UNEXPECTED_CALL');});
 const u=validateUnderstanding(await provider.understand(input(fa),signal()),fa);assert.equal(u.language,'fa');assert.equal(u.event.facts[0].arabic,raw.statements[0].evidence.arabic);assert.equal(calls,2);
 const draft=await provider.draft({content:fa,understanding:u,rules:ruleSet},signal());assert.ok(draft.title.includes('مدرسة'));assert.equal(calls,2);
});

test('strict completeness, speaker, reference and Arabic validators remain fail-closed',()=>{
 assert.throws(()=>validateDirectExtraction({...raw(),statements:[]},source),/INCOMPLETE_EXTRACTION/);
 assert.throws(()=>validateDirectExtraction({...raw(),action:ev('معلومة غير موجودة')},source),/AMBIGUOUS_EVIDENCE_CONTEXT/);
 const speech=raw();speech.statements[0].kind='STATEMENT';assert.throws(()=>adaptDirectExtraction(validateDirectExtraction(speech,source),source),/INVALID_ID_CLASSIFICATION|INVALID_DIRECT_EXTRACTION_SCHEMA/);
 assert.throws(()=>validateDirectExtraction({...raw(),relevance:'IRRELEVANT'},source),/INVALID_DIRECT_EXTRACTION_SCHEMA/);
 const english='The council opened a new school in the capital.';const x={...raw(),actors:[ev('council',english)],action:ev('opened',english),object:null,location:null,statements:[{evidence:ev(english,english),speaker:null,kind:'FACT',material:false}]};
 assert.throws(()=>adaptDirectExtraction(validateDirectExtraction(x,english),english),/VALIDATED_ARABIC_RENDERING_REQUIRED/);
});
test('provider failure does not produce a candidate and cost wait stays operational',async()=>{
 const p=new GeminiLanguageProvider('offline',async()=>new Response('{}',{status:503}));await assert.rejects(p.understand(input(),signal()),/GEMINI_HTTP_503/);
 for(const error of ['PROVIDER_COST_WAIT','PROVIDER_RPM_WAIT','PROVIDER_RPD_WAIT']){const d=editorialDecision({error},{autoPublish:false,shadowMode:true,requireApproval:true});assert.equal(d.editorialEligibility,'PROCESSING_ERROR');assert.deepEqual(d.review,[]);assert.equal(d.deliveryDecision,'HOLD');}
});
test('local database dynamic switching, audit, normal scope, DIRECT failure waits and idempotent ingestion',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
 const src=await saveSource(db,{platform:'TELEGRAM',handle:'directoffline',name:'offline'},'user:admin');assert.equal(src.processingMode,'NORMAL');
 const p=await ingest(db,src.id,{externalId:'1',url:src.url+'/1',content:source,publishedAt:new Date()});
 const normal=await claimJob(db,'normal');assert.ok(normal);
 const provider=new GeminiLanguageProvider('offline',async()=>{throw Error('NO_CALL_EXPECTED');});await processJob(db,normal,provider,signal());assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:p.id}})).error,'UNCERTAIN_SCOPE');
 await changeSourceProcessingMode(db,src.id,'DIRECT','user:admin');
 const q=await ingest(db,src.id,{externalId:'2',url:src.url+'/2',content:source,publishedAt:new Date()});await ingest(db,src.id,{externalId:'2',url:src.url+'/2',content:source,publishedAt:new Date()});
 assert.equal(await db.processingJob.count({where:{sourcePostId:q.id}}),1);
 const job=await claimJob(db,'direct');assert.ok(job);
 let calls=0;const blocked=new GeminiLanguageProvider('offline',async()=>{calls++;throw new ProcessingError('PROVIDER_COST_WAIT',true,undefined,1000);});
 await processJob(db,job,blocked,signal());const stored=await db.sourcePost.findUniqueOrThrow({where:{id:q.id}});assert.equal(stored.error,'PROVIDER_COST_WAIT');assert.ok(!JSON.stringify(stored.processingResult).includes('UNSUPPORTED_OUTPUT'));assert.equal((await db.processingJob.findUniqueOrThrow({where:{id:job.id}})).status,'RETRY');assert.equal(calls,1);
 await changeSourceProcessingMode(db,src.id,'NORMAL','user:admin');
 const audit=await db.auditLog.findMany({where:{entityId:src.id,action:'SOURCE_PROCESSING_MODE_CHANGED'},orderBy:{createdAt:'asc'}});assert.equal(audit.length,2);assert.deepEqual(audit.map(a=>a.metadata),[{previousMode:'NORMAL',processingMode:'DIRECT'},{previousMode:'DIRECT',processingMode:'NORMAL'}]);assert.ok(audit.every(a=>a.actor==='user:admin'));
 assert.equal((await db.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode,'REQUIRE_APPROVAL');assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});

test('DIRECT full local pipeline, guarded unattended path, duplicate claim and exact-text dedup',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const env={AUTO_PUBLISH:'true',REQUIRE_APPROVAL:'true',SHADOW_MODE:'false',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:offline_token',TELEGRAM_CHAT_ID:'-100123'};
 try{
 const src=await saveSource(db,{platform:'TELEGRAM',handle:'directcomplete',name:'offline',processingMode:'DIRECT'},'user:admin');
 await db.source.update({where:{id:src.id},data:{editorialProfile:{...unknownProfile,verified:true,classification:'NEUTRAL',authority:'AGENCY'}}});
 const p=await ingest(db,src.id,{externalId:'a',url:src.url+'/a',content:source,publishedAt:new Date()});
 const other=await db.processingJob.findMany({where:{sourcePostId:{not:p.id}},select:{sourcePostId:true}});
 const job=await claimJob(db,'complete',new Date(),false,other.map(j=>j.sourcePostId));assert.ok(job);
 let ai=0;await processJob(db,job,new GeminiLanguageProvider('offline',async()=>{ai++;return response(publicationRaw());}),signal());
 const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:p.id}}}});
 assert.equal(item.validationStatus,'PASSED');assert.equal(item.status,'PENDING_APPROVAL');assert.equal(ai,1);
 const eligible=await db.newsItem.findUniqueOrThrow({where:{id:item.id},include:{humanDraft:true,publication:true,eventRevision:true,evidence:{include:{sourcePost:{include:{source:true,jobs:true,matches:true,humanDraft:true}}}}}});
 assert.equal(eligibleDirectPublication(eligible),true);
 assert.equal(eligibleDirectPublication({...eligible,humanDraft:{id:'human'} as NonNullable<typeof eligible.humanDraft>}),false);
 assert.equal(eligibleDirectPublication({...eligible,validationResult:{...Object(eligible.validationResult),review:[{code:'UNSUPPORTED_OUTPUT'}]}}),false);
 assert.equal(eligibleDirectPublication({...eligible,error:'INVALID_EVIDENCE'}),false);
 const normal=structuredClone(eligible);normal.evidence[0].sourcePost.source.processingMode='NORMAL';assert.equal(eligibleDirectPublication(normal),false);
 let sends=0;const transport:typeof fetch=async()=>{sends++;return Response.json({ok:true,result:{message_id:99,chat:{id:-100123}}});};
 await assert.rejects(publishReadyDirect(db,item.id,{...env,AUTO_PUBLISH:'false'},transport),/DIRECT_AUTO_DISABLED/);assert.equal(sends,0);
 await assert.rejects(publishReadyDirect(db,item.id,{...env,SHADOW_MODE:'true'},transport),/PUBLISH_DISABLED/);assert.equal(sends,0);
 const results=await Promise.all([publishReadyDirect(db,item.id,env,transport),publishReadyDirect(db,item.id,env,transport)]);
 assert.equal(results.filter(r=>r.status==='SENT').length,1);assert.equal(sends,1);
 const pub=await db.publication.findUniqueOrThrow({where:{newsItemId:item.id}});assert.equal(pub.telegramMessageId,'99');assert.equal(pub.status,'SENT');assert.equal(pub.attemptCount,1);assert.ok(pub.contentSnapshot.includes(item.title));
 assert.equal((await publishReadyDirect(db,item.id,env,transport)).status,'NOT_ELIGIBLE');assert.equal(sends,1);
 assert.equal(await db.auditLog.count({where:{entityId:pub.id,action:'DIRECT_AUTO_PUBLICATION_APPROVED'}}),1);
 const d=await ingest(db,src.id,{externalId:'b',url:src.url+'/b',content:source,publishedAt:new Date()});
 const dupJob=await claimJob(db,'duplicate',new Date(),false,other.map(j=>j.sourcePostId));assert.ok(dupJob);
 await processJob(db,dupJob,new GeminiLanguageProvider('offline',async()=>{throw Error('EXACT_DUPLICATE_MUST_NOT_CALL');}),signal());assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:d.id}})).status,'DUPLICATE');assert.equal(await db.newsItem.count({where:{evidence:{some:{sourcePostId:d.id}}}}),0);
 assert.equal(await db.publication.count({where:{destination:'WEB'}}),0);
 }finally{await db.$disconnect();}
});
test('auto mode requires independent explicit delivery flags, never changes them',()=>{
 const env={AUTO_PUBLISH:'false',REQUIRE_APPROVAL:'true',SHADOW_MODE:'true',TELEGRAM_PUBLISH_ENABLED:'false'};const original={...env};assert.throws(()=>assertDirectAutoEnabled(env));assert.deepEqual(env,original);
});

test('empty DIRECT skips AI; a mode change during processing cannot commit a stale DIRECT decision',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
 const src=await saveSource(db,{platform:'TELEGRAM',handle:'directrace',name:'offline',processingMode:'DIRECT'},'user:admin');
 const empty=await ingest(db,src.id,{externalId:'empty',url:src.url+'/empty',content:'',publishedAt:new Date(),metadata:{transport:'telegram-shadow-v1',messageKind:'EMPTY'}});
 async function claim(id:string){const others=await db.processingJob.findMany({where:{sourcePostId:{not:id}},select:{sourcePostId:true}});const job=await claimJob(db,'race',new Date(),false,others.map(j=>j.sourcePostId));assert.ok(job);return job;}
 let calls=0;await processJob(db,await claim(empty.id),new GeminiLanguageProvider('offline',async()=>{calls++;throw Error('NO_NETWORK');}),signal());assert.equal(calls,0);assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:empty.id}})).error,'SOURCE_TEXT_REQUIRED');
 const p=await ingest(db,src.id,{externalId:'race',url:src.url+'/race',content:'افتتح المجلس مكتبة عامة في العاصمة.',publishedAt:new Date()});
 const text=p.originalContent,x={...raw(),actors:[ev('المجلس',text)],action:ev('افتتح',text),object:ev('مكتبة عامة',text),location:ev('العاصمة',text),statements:[{evidence:ev(text,text),speaker:null,kind:'FACT',material:false}]};
 const job=await claim(p.id);
 await processJob(db,job,new GeminiLanguageProvider('offline',async()=>{await changeSourceProcessingMode(db,src.id,'NORMAL','user:admin');return response({...x,coverage:[{unitId:"u1",factIds:["f1"],nonFactual:false}],publication:{title:{text:text.slice(0,-1),factIds:["f1"]},body:[]}});}),signal());
 const stored=await db.sourcePost.findUniqueOrThrow({where:{id:p.id}});assert.equal(stored.error,'SOURCE_PROCESSING_MODE_CHANGED');assert.equal(await db.newsItem.count({where:{evidence:{some:{sourcePostId:p.id}}}}),0);assert.equal((await db.processingJob.findUniqueOrThrow({where:{id:job.id}})).status,'RETRY');
 }finally{await db.$disconnect();}
});
