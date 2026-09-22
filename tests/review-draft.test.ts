import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {availableDraft,proposalDraft,reviewPrefill} from '../src/lib/processing/available-draft';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {ProcessingError,unknownProfile} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {bilingualFixture,geminiEnvelope,passingReview} from './fixtures/direct-bilingual';
import {prepareDirectBilingual} from '../src/lib/processing/direct-bilingual';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {fixture,official} from './fixtures/processing';
test('prefill never uses original source or claims validation; empty FLASH body retained',()=>{assert.equal(reviewPrefill({originalContent:'النص الأصلي'}),null);const p=proposalDraft({publication:{title:{text:'مسودة عربية'},body:[]}},'INVALID_EVIDENCE');assert(p);assert.equal(p.body,'');assert.equal(p.validated,false);assert.equal(reviewPrefill({availableDraft:p})?.title,'مسودة عربية');assert.equal(availableDraft({title:'Persian فارسی',body:''},'REVIEW'),null);});
test('Persian translation rejection preserves Arabic proposal without creating a receipt',async()=>{
 const f=bilingualFixture();let calls=0;const provider=new GeminiLanguageProvider('offline',async()=>{calls++;const review=passingReview(f.source,prepareDirectBilingual(f.raw,f.source));review.coverage.complete=false;return Response.json(geminiEnvelope(calls===1?f.raw:review));});
 await assert.rejects(provider.understand({processingMode:'DIRECT',content:f.source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal),e=>{assert(e instanceof ProcessingError);assert.equal(e.availableDraft?.title,f.raw.statements[0].evidence.arabic);assert.equal(e.availableDraft?.validated,false);return true;});assert.equal(calls,2);
});
test('Arabic rejected extraction preserves generated publication proposal',async()=>{
 const source='افتتح المجلس مدرسة جديدة.';const ev=(excerpt:string)=>({excerpt,context:source});const raw={actors:[ev('المجلس')],action:ev('فعل غير موجود'),object:null,location:null,event_time:null,statements:[{evidence:ev(source),speaker:null,kind:'FACT',material:false}],safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false},coverage:[{unitId:'u1',factIds:['f1'],nonFactual:false}],publication:{title:{text:'افتتح المجلس مدرسة جديدة',factIds:['f1']},body:[]}};
 const provider=new GeminiLanguageProvider('offline',async()=>Response.json(geminiEnvelope(raw)));
 await assert.rejects(provider.understand({processingMode:'DIRECT',content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal),e=>{assert(e instanceof ProcessingError);assert.equal(e.availableDraft?.title,raw.publication.title.text);assert.equal(e.availableDraft?.validated,false);return true;});
});
test('local DB failure retains unvalidated draft/error; no candidate or approval',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});try{
  const src=await db.source.create({data:{platform:'TELEGRAM',handle:'draftoffline',name:'offline',url:'https://t.me/draftoffline',processingMode:'DIRECT'}});
  const p=await ingest(db,src.id,{externalId:'1',url:src.url+'/1',content:'افتتح المجلس مدرسة جديدة.',publishedAt:new Date()});await db.processingJob.updateMany({where:{sourcePostId:p.id},data:{availableAt:new Date(0)}});const j=await claimJob(db,'draft');assert(j);
  const error=new ProcessingError('INVALID_EVIDENCE');error.availableDraft=availableDraft({title:'مسودة مفيدة للمحرر',body:'نص يحتاج إلى تدقيق.'},error.code)!;
  await processJob(db,j,{id:'offline',live:false,understand:async()=>{throw error;},draft:async()=>{throw Error('NO_CALL');},compare:async()=>{throw Error('NO_CALL');}},new AbortController().signal);
  const result=await db.sourcePost.findUniqueOrThrow({where:{id:p.id}});assert.equal(result.error,'INVALID_EVIDENCE');assert.equal(reviewPrefill(result.processingResult)?.title,'مسودة مفيدة للمحرر');assert.equal(result.status,'NEEDS_REVIEW');assert.equal(await db.newsItem.count(),0);assert.equal(await db.publication.count(),0);assert.equal(await db.humanEditorialDraft.count(),0);assert.equal(result.originalContent,p.originalContent);
 }finally{await db.$disconnect();}
});
test('later final-provenance failure retains generated draft while rolling back candidate creation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});try{
 const f=fixture('late-draft','عباس عراقجي يزور طهران');
 const s=await db.source.create({data:{platform:'TELEGRAM',handle:'latedraft',name:'offline',url:'https://t.me/latedraft',editorialProfile:official}});
 const p=await ingest(db,s.id,{externalId:'1',url:s.url+'/1',content:f.content,publishedAt:new Date()});
 await db.processingJob.updateMany({where:{sourcePostId:p.id},data:{availableAt:new Date(0)}});
 const j=await claimJob(db,'late');assert(j);
 const invalid={...f.draft,sentences:[{text:f.draft.title,factIds:['unknown']}]};
 await processJob(db,j,{id:'offline',live:false,understand:async()=>f.understanding,draft:async()=>invalid,compare:async()=>{throw Error('NO_COMPARE');}},new AbortController().signal);
 const saved=await db.sourcePost.findUniqueOrThrow({where:{id:p.id}});assert.equal(saved.error,'INVALID_DRAFT_FACT_LINK');assert.equal(reviewPrefill(saved.processingResult)?.title,f.draft.title);assert.equal(reviewPrefill(saved.processingResult)?.validated,false);assert.equal(await db.newsItem.count(),0);assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});

test('NORMAL classification failure preserves already reviewed Persian rendering',async()=>{
 const f=bilingualFixture();const p=prepareDirectBilingual(f.raw,f.source);
 const {finalizeDirectBilingual}=await import('../src/lib/processing/direct-bilingual');
 const receipt=finalizeDirectBilingual(f.source,p,passingReview(f.source,p));
 let calls=0;const provider=new GeminiLanguageProvider('offline',async()=>{calls++;return Response.json(geminiEnvelope({}));});
 await assert.rejects(provider.classifyExtracted({content:f.source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},{...p.grounded.extraction,relevance:'POLITICAL_NEWS'},new AbortController().signal,receipt),e=>{assert(e instanceof ProcessingError);assert.equal(e.availableDraft?.title,f.raw.statements[0].evidence.arabic);assert.equal(e.availableDraft?.validated,false);return true;});assert.equal(calls,1);
});
