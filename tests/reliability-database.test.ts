import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {ProcessingError,type LanguageProvider} from '../src/lib/processing/contracts';
import {guardedTransport,providerRequestDelay} from '../src/worker/provider-guard';
import {fixture,fixtureProvider} from './fixtures/processing';
test('offline database: bounded retry preserves source and audits; later success cannot duplicate events/news/publications',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');
 const db=new PrismaClient({datasourceUrl:url}),signal=new AbortController().signal;
 const source=await db.source.create({data:{platform:'TELEGRAM',name:'offline',handle:randomUUID(),url:'https://t.me/offline'}});
 const f=fixture('retry','افتتاح المستشفى الجديد في طهران','ar','افتتاح المستشفى الجديد في طهران');
 const provider=fixtureProvider([f]);let calls=0;
 const failed:LanguageProvider={id:'offline',live:false,understand:async()=>{calls++;throw new ProcessingError('GEMINI_HTTP_429');},compare:async()=>null,draft:async()=>null};
 const make=async(id:string,text:string)=>ingest(db,source.id,{externalId:id,url:'https://t.me/offline/1',content:text,publishedAt:new Date(),metadata:{}});
 const post=await make('one',f.content);
 const job=await claimJob(db,'offline');assert.ok(job);await processJob(db,job,failed,signal);
 let stored=await db.sourcePost.findUniqueOrThrow({where:{id:post.id}});assert.equal(stored.originalContent,f.content);assert.equal(stored.status,'FAILED');assert.equal(stored.error,'GEMINI_HTTP_429');
 assert.equal((await db.processingJob.findUniqueOrThrow({where:{id:job.id}})).status,'RETRY');
 // An unrelated locally decidable story is not blocked by the first job.
 const outside=await make('outside','زلزال في فرنسا');const next=await claimJob(db,'other');assert.ok(next);assert.equal(next.sourcePostId,outside.id);await processJob(db,next,failed,signal);assert.equal(calls,1);
 const held=await make('uncertain','أعلنت اللجنة عن افتتاح المدرسة الجديدة');const holdJob=await claimJob(db,'hold');assert.ok(holdJob);await processJob(db,holdJob,failed,signal);assert.equal(calls,1);
 assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:outside.id}})).rejectionReason,'OUTSIDE_EDITORIAL_SCOPE');assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:held.id}})).error,'UNCERTAIN_SCOPE');
 await db.processingJob.update({where:{id:job.id},data:{availableAt:new Date(0)}});
 const retry=await claimJob(db,'retry');assert.ok(retry);await processJob(db,retry,provider,signal);
 const counts=async()=>[await db.canonicalEvent.count(),await db.newsItem.count(),await db.publication.count()];const before=await counts();
 await processJob(db,retry,provider,signal);await make('one','attempted replacement');assert.deepEqual(await counts(),before);
 stored=await db.sourcePost.findUniqueOrThrow({where:{id:post.id}});assert.equal(stored.originalContent,f.content);assert.ok(await db.auditLog.count({where:{entityId:post.id,action:'PROCESSING_ERROR'}}));
 // Every finite attempt is persisted; exhausted provider errors retain a manual recovery state.
 const exhausted=await make('exhaust','افتتاح مستشفى آخر في طهران');
 const e=await claimJob(db,'exhaust');assert.ok(e);await db.processingJob.update({where:{id:e.id},data:{maxAttempts:1}});await processJob(db,{...e,maxAttempts:1},failed,signal);
 const last=await db.sourcePost.findUniqueOrThrow({where:{id:exhausted.id}});assert.equal(last.status,'FAILED');assert.match(JSON.stringify(last.processingResult),/SCHEDULED_RETRY/);
 assert.equal(await claimJob(db,'again'),null);assert.equal(await db.publication.count(),before[2]);await db.$disconnect();
});
test('durable native checkpoints survive new adapter, 429 opens circuit, ambiguous transport requires reconciliation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url});
 const baseline=await db.auditLog.count({where:{action:'PROVIDER_RESERVED',entityType:'ProviderBudget'}});
 let calls=0;const init={method:'POST',body:JSON.stringify({offline:true})};const postId=randomUUID();
 const fetchMock:typeof fetch=async()=>{calls++;return Response.json({candidates:[],usageMetadata:{}});};
 await guardedTransport(db,postId,fetchMock)('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',init);
 const replay=await guardedTransport(db,postId,fetchMock)('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',init);assert.equal(calls,1);assert.equal(replay.headers.get('x-worker-checkpoint-replayed'),'true');
 await assert.rejects(guardedTransport(db,randomUUID(),async()=>{calls++;return new Response('unavailable',{status:429,headers:{'retry-after':'120'}});})('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',init),/PROVIDER_TRANSIENT_WAIT/);
 assert.ok(await providerRequestDelay(db)>0);
 await assert.rejects(guardedTransport(db,randomUUID(),fetchMock)('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',init),/PROVIDER_CAPACITY_WAIT/);assert.equal(calls,2);
 assert.equal(await db.auditLog.count({where:{action:'PROVIDER_RESERVED',entityType:'ProviderBudget'}}),baseline+2);
 await db.$disconnect();
});
