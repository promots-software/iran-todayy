import {supportedLedger} from './fixtures/fidelity-review';
import {automaticDeliveryCycle} from '../src/lib/telegram/automatic-delivery';
import {publicationCandidateInclude,publicationReady} from '../src/lib/telegram/publication-policy';
import {publicationUnits} from '../src/lib/processing/direct-publication';
import {checkpointProvider,type CheckpointStore} from '../src/worker/checkpoints';
import test from 'node:test';import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {normalStage} from '../src/lib/processing/normal-v2';
import {ProcessingError,understandingSchema} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {official} from './fixtures/processing';
import {editorialContract,EDITORIAL_CONTRACT_SHA256} from '../src/lib/processing/editorial-contract';
import {renderingChecks} from '../src/lib/processing/rendering-contract';
import {finalizeConstrainedDraft} from '../src/lib/processing/local-finalization';
import {blockingEditorialReasons} from '../src/lib/processing/editorial-eligibility';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {outcomePage} from '../src/lib/processing-visibility';
const signal=()=>new AbortController().signal;
const envelope=(output:unknown)=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}});
function mock(source:string,options:{promo?:boolean;unrelated?:boolean;uncovered?:boolean;bad?:'rationale'|'emptyFacts'|'unknownFact'|'number'|'unsupported';always?:boolean;body?:string;flash?:boolean}={}){
 const calls:string[]=[];let failures=0;
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const request=JSON.parse(String(init?.body));const props=request.generationConfig.responseJsonSchema.properties;const data=JSON.parse(request.contents[0].parts[0].text);
  const stage=props.contentType?'extract':props.anchorIds?'classify':props.publication?'draft':props.entries?'render':data.references?'review_rendering':'review';calls.push(stage);
  if(stage==='extract'){if(data.repair&&options.uncovered){assert.equal(data.repair.stage,'extract');assert(data.repair.issues.some((i:{code:string})=>i.code==='MISSING_MATERIAL_FACT_REFERENCE'));}const excerpt=options.uncovered&&(options.always||calls.filter(s=>s==='extract').length===1)?source.split('— ')[1]:source;return envelope({coverage:publicationUnits(source).map(u=>({unitId:u.id,nonFactual:false,factIds:options.uncovered&&(options.always||calls.filter(s=>s==='extract').length===1)?[]:['f1']})),relevance:options.unrelated?'IRRELEVANT':'POLITICAL_NEWS',contentType:options.promo?'PURE_PROMO':'NEWS',contentTypeEvidence:{excerpt:source,context:source},actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt,context:source},speaker:null}]});}
  if(stage==='render'||stage==='review_rendering'){
   assert.equal(request.systemInstruction.parts[0].text.split(editorialContract).length,2);
   if(stage==='render')return envelope({entries:data.references.map((r:{id:string})=>({id:r.id,arabic:options.body??'افتتح المجلس مدرسة جديدة.'}))});
   return envelope({review:data.references.map((r:{id:string})=>({id:r.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]}))});
  }
  const broken=(kind:string)=>options.bad===kind&&(options.always||failures++===0);
  if(stage==='classify'){
   if(data.repair){assert.equal(data.repair.stage,'classify');assert.deepEqual(data.classificationReferences.requiredFactIds,['f1']);}
   return envelope({anchorIds:[],factLabels:[{id:'f1',kind:'FACT',material:false}],filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:broken('rationale')?[]:['f1']});
  }
  assert.equal(request.systemInstruction.parts[0].text.split(editorialContract).length,2);
  if(stage==='draft'){
   assert.deepEqual(data.validFactIds,['f1']);if(data.repair)assert.equal(data.repair.stage,'draft');
   const publication={title:{text:'إيران الآن | افتتاح مدرسة جديدة',factIds:['f1']},body:[{text:options.body??source,factIds:['f1']}]};
   if(options.flash){publication.title.text='إيران الآن | '+source.replace(/\.$/u,'');publication.body=[];}
   if(broken('emptyFacts'))publication.body[0].factIds=[];
   if(broken('unknownFact'))publication.title.factIds=['u1'];
   if(broken('number'))publication.body[0].text+=' وتضم 99 قاعة.';
   return envelope({coverage:publicationUnits(source).map(u=>({unitId:u.id,factIds:['f1'],nonFactual:false})),publication});
  }
  const ledger=supportedLedger(source,data.publication);for(const claim of ledger.claims)if(options.bad==='unsupported'||claim.excerpt.includes('99')){claim.verdict='UNSUPPORTED' as 'SUPPORTED';claim.explanation='Unsupported generated assertion/quantity: '+claim.excerpt;}
  return envelope({fidelityLedger:ledger,review:data.publication.map((p:{id:string})=>({id:p.id,verdict:options.bad==='unsupported'?'UNSUPPORTED':'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,options.bad!=='unsupported'])),issues:options.bad==='unsupported'?['UNSUPPORTED_FACT']:[]})),fullSourceCovered:true,publicationQuality:true,issues:options.bad==='unsupported'?['UNSUPPORTED_FACT']:[]});
 });return {provider,calls};
}
const input=(content:string)=>({content,publishedAt:new Date(),profile:official,rules:ruleSet});
for(const source of ['ضيف الحلقة اليوم فلان وسيتحدث عن الأوضاع السياسية','انتظرونا الليلة في مقابلة مع وزير الخارجية الإيراني.','موعد برنامج الحوار الساعة الثامنة مساء اليوم.','تابعوا حلقة خاصة عن إيران الليلة.'])test('NORMAL pure promo is selected structurally, not rewritten: '+source,async()=>{
 const p=mock(source,{promo:true});const u=await p.provider.understand(input(source),signal());assert.equal(u.filterReason,'NON_NEWS_PROMO');assert.equal(u.relevance,'IRRELEVANT');assert.deepEqual(p.calls,['extract']);
});
for(const source of ['قال المسؤول خلال مقابلة إن المجلس افتتح مدرسة جديدة.','أعلن المجلس في برنامج تلفزيوني افتتاح مدرسة جديدة.','افتتح المجلس مدرسة جديدة.'])test('substantive interview/news remains eligible: '+source,async()=>{const p=mock(source);const u=await p.provider.understand(input(source),signal());assert.equal(u.relevance,'POLITICAL_NEWS');assert.equal(u.normalContentType,'NEWS');assert.deepEqual(p.calls,['extract','classify']);});
for(const bad of ['rationale','emptyFacts','unknownFact','number'] as const)for(const always of [false,true])test(`${bad}: grounded prose repair only; invalid identifier/schema fails closed (${always})`,async()=>{
 const source='افتتح المجلس مدرسة جديدة.';const p=mock(source,{bad,always});
 const run=async()=>{const u=await p.provider.understand(input(source),signal());return p.provider.draft({content:source,understanding:u,rules:ruleSet},signal());};
 if(bad!=='number'){await assert.rejects(run());assert.equal(p.calls.filter(s=>s===(bad==='rationale'?'classify':'draft')).length,1);return;}
 if(always)await assert.rejects(run(),/AI_SCHEMA_REPAIR_FAILED/);else assert((await run()).title.startsWith('إيران الآن |'));
 assert.equal(p.calls.filter(s=>s==='extract').length,1);assert.equal(p.calls.filter(s=>s==='draft').length,2);
});
test('independent factual rejection cannot become READY through schema repair',async()=>{const source='افتتح المجلس مدرسة جديدة.';const p=mock(source,{bad:'unsupported'});const u=await p.provider.understand(input(source),signal());await assert.rejects(p.provider.draft({content:source,understanding:u,rules:ruleSet},signal()),/AI_SCHEMA_REPAIR_FAILED/);assert.equal(p.calls.filter(s=>s==='draft').length,2);assert(!u.publicationProposal);});
test('cost and transport waits do not cause repair calls',async()=>{for(const code of ['PROVIDER_COST_WAIT','GEMINI_HTTP_503','GEMINI_HTTP_429']){let calls=0;await assert.rejects(normalStage('draft',async()=>{calls++;throw new ProcessingError(code,true);}),new RegExp(code));assert.equal(calls,1);}});
for(const source of ['افتتح المجلس مدرسة جديدة.','المجلس قام بافتتاح مدرسة جديدة وذلك اليوم.','تم من قبل المجلس افتتاح مدرسة جديدة.','افتتح المجلس مدرسة جديدة.\nافتتح المجلس مدرسة جديدة.','المدرسة الجديدة تم افتتاحها من قبل المجلس.'])test('good/awkward/literal Arabic always generated under complete contract, not style-review routed: '+source,async()=>{
 const p=mock(source,{body:source.includes('اليوم')?'افتتح المجلس مدرسة جديدة اليوم.':'افتتح المجلس مدرسة جديدة.'});const u=await p.provider.understand(input(source),signal());const draft=await p.provider.draft({content:source,understanding:u,rules:ruleSet},signal());assert(p.calls.includes('draft'));assert.equal(u.publicationProposal?.editorialContractHash,EDITORIAL_CONTRACT_SHA256);const final=finalizeConstrainedDraft(draft,source,u,official);assert.equal(blockingEditorialReasons(final.review).length,0);assert(/[.؟!]$/u.test(final.body||final.title));
});
test('promo is durable and visible; missing canonical generation cannot become READY',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url});try{
 const s=await db.source.create({data:{name:'Offline newsroom',handle:'normalv2',platform:'TELEGRAM',url:'https://t.me/normalv2',processingMode:'NORMAL',editorialProfile:official}});
 const content='انتظرونا الليلة في مقابلة مع وزير الخارجية الإيراني.';const post=await ingest(db,s.id,{externalId:'1',content,url:s.url+'/1',publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});const job=await claimJob(db,'offline');assert(job);await processJob(db,job,mock(content,{promo:true}).provider,signal());
 const row=await db.sourcePost.findUniqueOrThrow({where:{id:post.id}});assert.equal(row.status,'FILTERED');assert.equal(row.rejectionReason,'NON_NEWS_PROMO');assert.equal((await outcomePage(db,{post:post.id,state:'rejected'},1)).total,1);assert.equal(await db.newsItem.count(),0);assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});

test('NORMAL canonical receipt survives replay; live bypass blocked; OFF/ON publisher keeps exactly-once',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url});try{
 const src=await db.source.create({data:{platform:'TELEGRAM',handle:'normalready',name:'Offline',url:'https://t.me/normalready',enabled:true,processingMode:'NORMAL',editorialProfile:official}});
 const source='المجلس قام بافتتاح مدرسة جديدة وذلك اليوم.';const p=mock(source,{body:'افتتح المجلس مدرسة جديدة اليوم.'});
 const cache=new Map<string,unknown>();const store:CheckpointStore={load:async k=>cache.has(k)?{output:cache.get(k)}:null,start:async()=>{},finish:async(k,v)=>{cache.set(k,structuredClone(v));}};
 const replay=checkpointProvider(p.provider,store);const savedInput=input(source);const u=understandingSchema.parse(await replay.understand(savedInput,signal()));const draft=await replay.draft({content:source,understanding:u,rules:ruleSet},signal());assert(draft&&typeof draft==='object');assert('normalGeneration' in draft);const before=p.calls.length;
 const reloaded=understandingSchema.parse(await replay.understand(savedInput,signal()));await replay.draft({content:source,understanding:reloaded,rules:ruleSet},signal());assert.equal(p.calls.length,before);
 const bad=await ingest(db,src.id,{externalId:'1',url:src.url+'/1',content:source,publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:bad.id},data:{availableAt:new Date(0)}});const badJob=await claimJob(db,'bad');assert(badJob);
 const bypass={...replay,draft:async()=>{const copy={...draft} as Record<string,unknown>;delete copy.normalGeneration;return copy as unknown as typeof draft;}};
 await processJob(db,badJob,bypass,signal());assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:bad.id}})).error,'AI_CANONICAL_RENDER_REQUIRED');assert.equal(await db.newsItem.count(),0);
 const post=await ingest(db,src.id,{externalId:'2',url:src.url+'/2',content:source,publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});const job=await claimJob(db,'normal');assert(job);const outcome=await processJob(db,job,mock(source,{body:'افتتح المجلس مدرسة جديدة اليوم.'}).provider,signal());assert(!('error' in outcome),JSON.stringify(outcome));
 const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:post.id}}},include:publicationCandidateInclude});assert.equal(item.status,'PENDING_APPROVAL');assert.equal(Object(item.validationResult).editorialEligibility,'READY_TO_PUBLISH');assert.equal(publicationReady(item),true);assert.equal(publicationReady({...item,humanDraft:{id:'edited'} as NonNullable<typeof item.humanDraft>}),false);
 let sends=0;const transport:typeof fetch=async()=>{sends++;return Response.json({ok:true,result:{message_id:10,chat:{id:-100123}}});};const env={AUTO_PUBLISH:'true',SHADOW_MODE:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123'};
 await automaticDeliveryCycle(db,env,transport);assert.equal(sends,0);
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{version:'telegram-auto-v1',id:'11111111-1111-4111-8111-111111111111',state:'ACTIVE',destination:'-100123',notBefore:new Date(0).toISOString(),sourceIds:[src.id],canaryCandidateId:null,authorizedBy:'offline'}}});await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);await automaticDeliveryCycle(db,env,transport);assert.equal(sends,1);
 }finally{await db.$disconnect();}
});

test('NORMAL canonical FLASH finishes punctuation with exact title provenance',async()=>{
 const source='افتتح المجلس مدرسة جديدة.';const p=mock(source,{flash:true});const u=await p.provider.understand(input(source),signal());const d=await p.provider.draft({content:source,understanding:u,rules:ruleSet},signal());const f=finalizeConstrainedDraft(d,source,u,official);assert.equal(f.body,'');assert(f.title.endsWith('.'));assert(f.sentenceEvidence.some(e=>e.text===f.title));assert(p.calls.includes('draft'));
});

for(const source of ['شورای شهر مدرسه جدیدی افتتاح کرد.','The council has opened a new school.'])test('NORMAL foreign source retains independent translation review and complete final renderer: '+source,async()=>{
 const p=mock(source,{body:'افتتح المجلس مدرسة جديدة.'});const u=await p.provider.understand(input(source),signal());assert(u.rendering);const draft=await p.provider.draft({content:source,understanding:u,rules:ruleSet},signal());const final=finalizeConstrainedDraft(draft,source,u,official);assert.deepEqual(p.calls,['extract','render','review_rendering','classify','draft','review']);assert.equal(blockingEditorialReasons(final.review).length,0);assert(final.body.includes('افتتح المجلس'));
});

// Structural replay of the live failure: evidence omitted a leading source label.
// The renderer cannot repair immutable evidence; repair belongs to extraction.
for(const [source,body] of [
 ['تنبيه تجريبي — افتتح المجلس مدرسة جديدة.','تنبيه تجريبي — افتتح المجلس مدرسة جديدة.'],
 ['برچسب آزمایشی — شورا مدرسه جدیدی افتتاح کرد.','وسم تجريبي — افتتح المجلس مدرسة جديدة.'],
 ['Experimental label — The council has opened a new school.','وسم تجريبي — افتتح المجلس مدرسة جديدة.'],
 ['تنبيه تجريبي — المجلس قام بافتتاح مدرسة جديدة وذلك اليوم.','تنبيه تجريبي — افتتح المجلس مدرسة جديدة اليوم.'],
 ['تنبيه تجريبي — قال المجلس إنه افتتح مدرسة جديدة. وأضاف أنه سيعلن التفاصيل لاحقاً.','تنبيه تجريبي — قال المجلس إنه افتتح مدرسة جديدة. وأضاف أنه سيعلن التفاصيل لاحقاً.'],
 ['تنبيه تجريبي — افتتح المجلس 3 مدارس اليوم بعد 4 ساعات من المراجعة.','تنبيه تجريبي — افتتح المجلس 3 مدارس اليوم بعد 4 ساعات من المراجعة.'],
])test('source occurrence restores representation without rewriting evidence: '+source,async()=>{
 const p=mock(source,{uncovered:true,body});const u=await p.provider.understand(input(source),signal());const draft=await p.provider.draft({content:source,understanding:u,rules:ruleSet},signal());
 assert.equal(p.calls.filter(s=>s==='extract').length,1);assert.equal(p.calls.filter(s=>s==='classify').length,1);assert.equal(p.calls.filter(s=>s==='draft').length,1);assert.equal(u.event.facts[0].evidence.excerpt,source.split('— ')[1]);assert('normalGeneration' in draft);assert.equal(u.publicationProposal?.editorialContractHash,EDITORIAL_CONTRACT_SHA256);
});
test('source mapping is not a semantic completeness certificate',async()=>{const source='تنبيه تجريبي — افتتح المجلس مدرسة جديدة.';const p=mock(source,{uncovered:true,always:true,bad:'unsupported'});const u=await p.provider.understand(input(source),signal());await assert.rejects(p.provider.draft({content:source,understanding:u,rules:ruleSet},signal()));assert.equal(p.calls.filter(s=>s==='extract').length,1);assert(!u.publicationProposal);});

test('UNRELATED bypasses coverage repair and rendering without changing selection',async()=>{const source='تنبيه تجريبي — افتتح المجلس مدرسة جديدة.';const p=mock(source,{unrelated:true,uncovered:true});const u=await p.provider.understand(input(source),signal());assert.equal(u.filterReason,'UNRELATED_TO_IRAN');assert.equal(u.relevance,'IRRELEVANT');assert.deepEqual(p.calls,['extract']);});
