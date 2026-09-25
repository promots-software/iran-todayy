import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {ProcessingError,type LanguageProvider} from '../src/lib/processing/contracts';
for(const [code,status] of [['GEMINI_TRANSPORT_FAILED','FAILED'],['APPLICATION_CONTINUATION_BUDGET','RETRY'],['GEMINI_HTTP_503','RETRY']] as const)test('engine scheduling honors checkpoint policy despite retryable flag: '+code,{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url});
 try{
  const s=await db.source.create({data:{name:'Offline',platform:'TELEGRAM',handle:code.toLowerCase(),url:'https://t.me/offline'}});
  const post=await ingest(db,s.id,{externalId:'1',content:'افتتح المجلس الإيراني مدرسة جديدة في طهران.',url:s.url+'/1',publishedAt:new Date()});
  const job=await claimJob(db,'offline');assert(job);assert.equal(job.sourcePostId,post.id);let calls=0;
  const provider:LanguageProvider={id:'offline',live:false,understand:async()=>{calls++;throw new ProcessingError(code,true);},compare:async()=>{throw Error('unexpected compare');},draft:async()=>{throw Error('unexpected draft');}};
  await processJob(db,job,provider,new AbortController().signal);
  assert.equal((await db.processingJob.findUniqueOrThrow({where:{id:job.id}})).status,status);assert.equal(calls,1);
  assert.equal(await db.publication.count(),0);assert.equal(await db.publicationAttempt.count(),0);
  assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:post.id}})).originalContent,post.originalContent);
 }finally{await db.$disconnect();}
});
