import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {TelegramMonitor,TelegramReader,activationCursor,type ReadMessage} from '../src/lib/telegram/monitor';
import {ingest,pollSources} from '../src/lib/processing/engine';
import {saveSource,changeSource,changeSourceProcessingMode} from '../src/lib/source-service';
import {saveHumanDraft} from '../src/lib/human-editorial';
import type {TelegramClient} from 'teleproto';
const signal=new AbortController().signal;
const msg=(id:number):ReadMessage=>({id,text:'خبر جديد',date:1700000000+id});
const old={kind:'telegram-shadow-v1' as const,channelId:'123',lastId:9};
test('latest read requests one newest message, not an ascending history page',async()=>{
 let options:unknown;const reader=new TelegramReader({getMessages:async(_h:string,o:unknown)=>{options=o;return[];}} as unknown as TelegramClient);
 await reader.messages('channel',null);assert.deepEqual(options,{limit:1});
 await reader.messages('channel',100);assert.deepEqual(options,{limit:50,minId:100,reverse:true});
});
test('empty channel initializes zero; pending activation never moves a checkpoint backward',async()=>{
 const m=new TelegramMonitor({channel:async()=> '123',messages:async()=>[]});
 const first=await m.poll({handle:'channel',cursor:null},signal);assert.equal(first.cursor.baselineId,0);assert.equal(first.posts.length,0);
 const resumed=await m.poll({handle:'channel',cursor:activationCursor(old)},signal);assert.equal(resumed.cursor.lastId,9);assert.equal(resumed.cursor.baselineId,9);
});
for(const mode of ['DIRECT','NORMAL'] as const)test(`${mode}: 10000 history, atomic baseline, new post, restart, mode change and reactivation`,{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url});
 try{
  await db.source.updateMany({data:{enabled:false}});
  const s=await saveSource(db,{platform:'TELEGRAM',handle:'baseline_'+mode.toLowerCase(),name:'offline',processingMode:mode},'offline');
  const history=Array.from({length:10000},(_,i)=>msg(i+1));
  const reader={channel:async()=> '123',messages:async(_h:string,after:number|null)=>after===null?history.slice(-1):history.filter(m=>m.id>after).slice(0,50)};
  const poll=()=>pollSources(db,{TELEGRAM:new TelegramMonitor(reader)},signal);
  await Promise.all([poll(),poll()]);
  const initialized=await db.source.findUniqueOrThrow({where:{id:s.id}});assert.equal((initialized.cursor as {lastId:number}).lastId,10000);
  assert.equal(await db.sourcePost.count({where:{sourceId:s.id}}),0);assert.equal(await db.auditLog.count({where:{action:'SOURCE_BASELINE_INITIALIZED',entityId:s.id}}),1);
  await assert.rejects(ingest(db,s.id,{externalId:'10000',content:'archive',publishedAt:new Date(),url:s.url+'/10000',metadata:{transport:'telegram-shadow-v1'}},true),/TELEGRAM_BEFORE_BASELINE/);
  history.push(msg(10001));await poll();await poll();
  assert.equal(await db.sourcePost.count({where:{sourceId:s.id}}),1);assert.equal(await db.processingJob.count({where:{sourcePost:{sourceId:s.id}}}),1);
  const cursor=(await db.source.findUniqueOrThrow({where:{id:s.id}})).cursor;
  await changeSourceProcessingMode(db,s.id,mode==='NORMAL'?'DIRECT':'NORMAL','offline');await poll();assert.deepEqual((await db.source.findUniqueOrThrow({where:{id:s.id}})).cursor,cursor);
  await changeSource(db,s.id,'enable','offline');await poll();assert.deepEqual((await db.source.findUniqueOrThrow({where:{id:s.id}})).cursor,cursor);
  await changeSource(db,s.id,'disable','offline');history.push(msg(10002));await changeSource(db,s.id,'enable','offline');await poll();assert.equal(await db.sourcePost.count({where:{sourceId:s.id}}),1);
  history.push(msg(10003));await poll();assert.equal(await db.sourcePost.count({where:{sourceId:s.id}}),2);
  await changeSource(db,s.id,'remove','offline');history.push(msg(10004));await saveSource(db,{platform:'TELEGRAM',handle:s.handle,name:s.name,processingMode:mode},'offline');await poll();assert.equal(await db.sourcePost.count({where:{sourceId:s.id}}),2);
  history.push(msg(10005));await poll();assert.equal(await db.sourcePost.count({where:{sourceId:s.id}}),3);
  const p=await db.sourcePost.findFirstOrThrow({where:{sourceId:s.id}});await db.sourcePost.update({where:{id:p.id},data:{status:'REJECTED',rejectionReason:'HISTORICAL_INGESTION_RETIRED'}});
  await assert.rejects(saveHumanDraft(db,{kind:'post',id:p.id,revision:0,title:'خبر',body:'النص'},'offline'),/HISTORICAL_INGESTION_RETIRED/);
  assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});
