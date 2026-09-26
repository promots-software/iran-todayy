import test from 'node:test';
import assert from 'node:assert/strict';
import {generateFirst,assertGenerationRequired,type PreGenerationAudit} from '../src/lib/processing/pre-generation';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {ProcessingError,unknownProfile} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {editorialContract} from '../src/lib/processing/editorial-contract';
import {combinedFixture,reviewedFixture} from './fixtures/current-direct';
import {assumedPropositionResponse} from './fixtures/proposition-mock';
import frozen from './fixtures/staging-hardening/frozen-13.json';
process.env.SHADOW_MODE='true';process.env.AUTO_PUBLISH='false';process.env.TELEGRAM_PUBLISH_ENABLED='false';
const source='افتتحت بلدية طهران مكتبة عامة في العاصمة الإيرانية.';
const article={title:'إيران الآن | '+source,body:'',diagnostics:[]};
const signal=new AbortController().signal;
const response=(output:unknown)=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:0,candidatesTokenCount:0,thoughtsTokenCount:0}});
for(const mode of ['NORMAL','DIRECT'] as const){
 test(mode+' usable Iran-related reaches generation before malformed extraction',async()=>{
  const order:string[]=[];
  const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
   const r=JSON.parse(String(init?.body)),props=r.generationConfig.responseJsonSchema.properties;
   if(props.iranRelated){order.push('intake');return response({iranRelated:true,rationale:'حدث في طهران'});}
   if(props.title){order.push('generation');assert.equal(r.systemInstruction.parts[0].text.split(editorialContract).length,2);return response(article);}
   order.push('extraction');return response({broken:'bookkeeping'});
  },()=>{},true);
  const generatedInput=await p.prepareGeneration({content:source},signal);
  await assert.rejects(p.understand({content:source,processingMode:mode,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet,generatedInput},signal));
  assert.deepEqual(order,['intake','generation','extraction']);assert(generatedInput.audit.articleReturned);
 });
 test(mode+' unrelated is filtered without generation',async()=>{
  let calls=0;const p=new GeminiLanguageProvider('offline',async()=>{calls++;return response({iranRelated:false,rationale:'النص لا يتصل بإيران'});},()=>{},true);
  const generatedInput=await p.prepareGeneration({content:'افتتحت بلدية باريس مكتبة.'},signal);
  const u=await p.understand({content:'افتتحت بلدية باريس مكتبة.',processingMode:mode,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet,generatedInput},signal);
  assert.equal(u.filterReason,'UNRELATED_TO_IRAN');assert.equal(calls,1);
 });
 for(const content of ['', '   ', '📷', '\ufffd\ufffd'])test(mode+' unusable input '+JSON.stringify(content),async()=>{
  let calls=0;const p=new GeminiLanguageProvider('offline',async()=>{calls++;throw Error('forbidden');},()=>{},true);
  await assert.rejects(p.prepareGeneration({content},signal),/SOURCE_TEXT_REQUIRED/);assert.equal(calls,0);
 });
}
for(const mode of ['NORMAL','DIRECT'] as const)for(const defect of ['excerpt','offset','unknownFact','missingCoverage'] as const)test(mode+' generation precedes exact '+defect+' validation',async()=>{
 const order:string[]=[];
 const x=structuredClone(combinedFixture(source,source,source).extraction);
 if(defect==='excerpt')x.statements[0].evidence.excerpt='نص غير موجود';
 if(defect==='offset')Object.assign(x.statements[0].evidence,{startOffset:999,endOffset:1000});
 if(defect==='unknownFact')x.coverage[0].factIds=['f999'];
 if(defect==='missingCoverage')x.coverage=[];
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const r=JSON.parse(String(init?.body)),props=r.generationConfig.responseJsonSchema.properties;
  if(props.iranRelated){order.push('intake');return response({iranRelated:true,rationale:'Iran'});}
  if(props.title){order.push('generation');return response(article);}
  order.push('validation-data');
  if(order.length>3)return response({}); // metadata correction cannot hide fixture defect
  if(mode==='DIRECT')return response({extraction:x});
  const {safety:unused,statements,...rest}=x;void unused;return response({...rest,statements:statements.map(({evidence,speaker})=>({evidence,speaker}))});
 },()=>{},true);
 const generatedInput=await p.prepareGeneration({content:source},signal);
 await assert.rejects(p.understand({content:source,processingMode:mode,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet,generatedInput},signal));
 assert.deepEqual(order.slice(0,3),['intake','generation','validation-data']);assert(generatedInput.audit.articleReturned);
});
test('missing mandatory generation is an application invariant error',()=>assert.throws(()=>assertGenerationRequired({audit:{usableSourceContent:true,iranRelated:true,generationRequired:false,generationReached:false,articleReturned:false}}),/IRAN_RELATED_STORY_DID_NOT_REACH_GENERATION/));
test('capacity errors preserve retry code and expose unmet article outcome',async()=>{
 const events:PreGenerationAudit[]=[];
 await assert.rejects(generateFirst(source,async()=>({iranRelated:true,rationale:'Iran'}),async()=>{throw new ProcessingError('PROVIDER_COST_WAIT',true);},async e=>{events.push(e);}),e=>e instanceof ProcessingError&&e.code==='PROVIDER_COST_WAIT'&&e.retryable);
 assert.equal(events.at(-1)?.causeCode,'PROVIDER_COST_WAIT');assert.equal(events.at(-1)?.articleReturned,false);assert.equal(events.at(-1)?.generationRequired,true);
});
test('DIRECT generated V0 remains exact through all existing independent validation stages',async()=>{
 const stages:string[]=[];
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const r=JSON.parse(String(init?.body)),d=JSON.parse(r.contents[0].parts[0].text),props=r.generationConfig.responseJsonSchema.properties;
  if(props.iranRelated){stages.push('intake');return response({iranRelated:true,rationale:'Iran'});}
  if(props.title){stages.push('generation');return response(article);}
  const v=assumedPropositionResponse(d);
  if(v!==undefined){stages.push('proposition');return response(v);}
  if(props.extraction){stages.push('extraction');const {article:unused,...x}=combinedFixture(source,source,source);void unused;assert.deepEqual(d.frozenArticle,article);return response(x);}
  stages.push('review');return response(reviewedFixture(source,d.publication));
 },()=>{},true);
 const generatedInput=await p.prepareGeneration({content:source},signal);
 const u=await p.understand({content:source,processingMode:'DIRECT',publishedAt:new Date(),profile:unknownProfile,rules:ruleSet,generatedInput},signal);
 const draft=await p.draft({content:source,processingMode:'DIRECT',understanding:u,rules:ruleSet,generatedInput},signal) as {title:string};
 assert.equal(draft.title,article.title);assert.deepEqual(stages,['intake','generation','extraction','review','proposition','proposition','proposition','proposition']);assert.equal(u.propositionReview?.verdict,'SUPPORTED');
});
// Frozen replay is a boundary replay, NOT fabricated provider completion. Relevance
// below is a transparent offline source-text adjudication, not a model result.
const unrelated=new Set(['80180','80182']);
for(const item of frozen)test('frozen generation boundary '+item.source+'/'+item.externalId,async()=>{
 const usable=!!item.normalized.trim(),related=usable&&!unrelated.has(item.externalId);
 const oldArticle=item.outputs.some(x=>{const o=x.output as {article?:unknown;publication?:unknown};return !!(o.article||o.publication);});
 let reached=false;
 try{await generateFirst(item.normalized,async()=>({iranRelated:related,rationale:'Offline source adjudication'}),async()=>{reached=true;throw new ProcessingError('OFFLINE_GENERATION_REQUIRED');});}catch(e){assert(e instanceof ProcessingError);assert.equal(e.code,usable?'OFFLINE_GENERATION_REQUIRED':'SOURCE_TEXT_REQUIRED');}
 assert.equal(reached,related);
 console.log(JSON.stringify({post:item.externalId,source:item.source,oldTerminal:item.terminal,usable,iranRelated:related,oldStoppedBeforeGeneration:!oldArticle,generationMandatory:related,newResult:!usable?'SOURCE_TEXT_REQUIRED':!related?'FILTERED / UNRELATED_TO_IRAN':!oldArticle?'PRE-GENERATION BLOCK REMOVED — GENERATION REQUIRED ON NEXT LIVE RUN':'GENERATION BEFORE ALL BOOKKEEPING; POST-GENERATION VALIDATION STILL REQUIRED',historicalArticleMissing:!oldArticle}));
});

for(const id of ['75','76','78'])test('persisted '+id+' bookkeeping cannot run before real provider generation boundary',async()=>{
 const item=frozen.find(p=>p.externalId===id)!;const stages:string[]=[];let historical=0;
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const r=JSON.parse(String(init?.body)),props=r.generationConfig.responseJsonSchema.properties;
  if(props.iranRelated){stages.push('intake');return response({iranRelated:true,rationale:'Frozen source relates materially to Iran'});}
  if(props.title){stages.push('generation');throw new ProcessingError('OFFLINE_GENERATION_REQUIRED');}
  historical++;return response(item.outputs[historical-1]?.output);
 },()=>{},true);
 await assert.rejects(p.prepareGeneration({content:item.normalized},signal),/OFFLINE_GENERATION_REQUIRED/);
 assert.deepEqual(stages,['intake','generation']);assert.equal(historical,0);
});
for(const mode of ['NORMAL','DIRECT'] as const)for(const defect of ['faithful','unsupported','temporal','attribution'] as const)test(mode+' post-generation '+defect+' remains independently validated',async()=>{
 const text=defect==='temporal'?'تخطط إيران لافتتاح مدرسة.':defect==='attribution'?'قال وزير الخارجية الإيراني إن الاجتماع انتهى.':source;
 const title=defect==='temporal'?'إيران الآن | افتتحت إيران مدرسة.':defect==='attribution'?'إيران الآن | قال الرئيس الإيراني إن الاجتماع انتهى.':defect==='unsupported'?'إيران الآن | '+source+' لتحقيق مكاسب سياسية.':article.title;
 const copy={title,body:'',diagnostics:[]};let repairs=0,reviews=0;
 const cache=new Map<string,Response>();
 const transport:typeof fetch=async(_url,init)=>{
  const r=JSON.parse(String(init?.body)),props=r.generationConfig.responseJsonSchema.properties,d=JSON.parse(r.contents[0].parts[0].text);
  if(d.repair){repairs++;assert(d.repair.diagnostics.length>0);throw new ProcessingError('OFFLINE_R1_BOUNDARY');}
  if(props.iranRelated)return response({iranRelated:true,rationale:'Iran'});
  if(props.title)return response(copy);
  const v=assumedPropositionResponse(d);if(v!==undefined)return response(v);
  const x=combinedFixture(text,text,text).extraction;
  if(props.extraction)return response({extraction:x});
  if(props.contentType){const {safety:unused,statements,...rest}=x;void unused;return response({...rest,statements:statements.map(({evidence,speaker})=>({evidence,speaker}))});}
  if(props.anchorIds)return response({anchorIds:[],factLabels:[{id:'f1',kind:'FACT',material:false}],filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:['f1']});
  if(props.publication){assert.deepEqual(d.frozenArticle,copy);return response({coverage:x.coverage,publication:{title:{text:copy.title,factIds:['f1']},body:[]}});}
  reviews++;
  const result=reviewedFixture(text,d.publication);
  if(defect!=='faithful')for(const c of result.fidelityLedger.claims){c.verdict='UNSUPPORTED' as 'SUPPORTED';c.components[0].verdict='UNSUPPORTED';c.components[0].explanation='Source does not support the generated material change';}
  if(mode==='NORMAL'){const {comparisons:unused,...review}=result;void unused;return response(review);}
  return response(result);
 };
 const run=async()=>{const p=new GeminiLanguageProvider('offline',async(url,init)=>{const key=String(init?.body);const old=cache.get(key);if(old){const r=old.clone();r.headers.set('x-worker-checkpoint-replayed','true');return r;}const r=await transport(url,init);cache.set(key,r.clone());return r;},()=>{},true);const generatedInput=await p.prepareGeneration({content:text},signal);const u=await p.understand({content:text,processingMode:mode,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet,generatedInput},signal);return p.draft({content:text,processingMode:mode,understanding:u,rules:ruleSet,generatedInput},signal);};
 if(defect==='faithful'){if(mode==='NORMAL')await assert.rejects(run(),/APPLICATION_CONTINUATION_BUDGET/);assert.equal((await run()).title,copy.title);assert.equal(repairs,0);}else{await assert.rejects(run());assert(repairs<=1);}
 assert.equal(reviews,1);
});

import {PrismaClient} from '@prisma/client';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
for(const mode of ['NORMAL','DIRECT'] as const)test(mode+' engine persists PRE_GENERATION before post-generation evidence failure',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url});
 try{
  const src=await db.source.create({data:{platform:'TELEGRAM',handle:'pregen_'+mode.toLowerCase(),name:'Offline generation gate',url:'https://t.me/offline_generation',enabled:true,processingMode:mode}});
  const post=await ingest(db,src.id,{externalId:'1',content:source,url:src.url+'/1',publishedAt:new Date()});
  await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});
  const job=await claimJob(db,'offline-generation');assert(job);let reached=false;
  const result=await processJob(db,job,{id:'offline-generation',live:false,generationFirst:true,
   prepareGeneration:async(input,_signal,observe)=>generateFirst(input.content,async()=>({iranRelated:true,rationale:'Iran'}),async()=>{reached=true;return article;},observe),
   understand:async input=>{assert(reached);assert(input.generatedInput?.article);throw new ProcessingError('INVALID_EVIDENCE');},compare:async()=>{throw Error('not reached');},draft:async()=>{throw Error('not reached');}},signal);
  assert('error'in result);assert.equal(result.error,'INVALID_EVIDENCE');
  const rows=await db.auditLog.findMany({where:{entityType:'SourcePost',entityId:post.id,action:'PRE_GENERATION'}});
  assert(rows.some(r=>(r.metadata as unknown as PreGenerationAudit).articleReturned));
  assert.equal(await db.publication.count(),0);assert.equal(await db.publicationAttempt.count(),0);
 }finally{await db.$disconnect();}
});

test('isolated damaged character cannot discard otherwise usable source text',async()=>{let reached=false;await generateFirst('\ufffd'+source,async()=>({iranRelated:true,rationale:'Iran'}),async()=>{reached=true;return article;});assert(reached);});

import {fixture,fixtureProvider,official} from './fixtures/processing';
test('generation-first engine still folds repeated event into one NewsItem',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url});
 try{
  const text='عباس عراقجي يزور طهران',f=fixture('generationfirstdup',text),base=fixtureProvider([f]);let generated=0;
  const provider={id:base.id,live:false,generationFirst:true,
   prepareGeneration:async(input:{content:string},_signal:AbortSignal,observe?:import('../src/lib/processing/pre-generation').GenerationObserver)=>generateFirst(input.content,async()=>({iranRelated:true,rationale:'Iran'}),async()=>{generated++;return {title:text,body:'',diagnostics:[]};},observe),
   understand:base.understand.bind(base),compare:base.compare.bind(base),draft:base.draft.bind(base)};
  const src=await db.source.create({data:{platform:'TELEGRAM',handle:'pregen_duplicate',name:'Offline',url:'https://t.me/offline_generation',enabled:true,processingMode:'NORMAL',editorialProfile:official}});
  const posts:string[]=[];
  for(const id of ['1','2']){
   const post=await ingest(db,src.id,{externalId:id,content:text,url:src.url+'/'+id,publishedAt:new Date()});posts.push(post.id);
   await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});const job=await claimJob(db,'offline-duplicate');assert(job);const outcome=await processJob(db,job,provider,signal);assert(!('error'in outcome),JSON.stringify(outcome));
  }
  assert.equal(generated,2);assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:posts[1]}})).status,'DUPLICATE');
  assert.equal(await db.newsItem.count({where:{evidence:{some:{sourcePostId:{in:posts}}}}}),1);assert.equal(await db.publication.count(),0);assert.equal(await db.publicationAttempt.count(),0);
 }finally{await db.$disconnect();}
});
