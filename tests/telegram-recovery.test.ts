import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {Api, type TelegramClient} from 'teleproto';
import {TelegramReader, type ReadMessage} from '../src/lib/telegram/monitor';
import {TelegramPoller, type PollConnection} from '../src/worker/telegram-poller';
import {pollSources, type PollProgress} from '../src/lib/processing/engine';
import {ProcessingError} from '../src/lib/processing/contracts';

const signal=new AbortController().signal;
const cursor=(lastId:number)=>({kind:'telegram-shadow-v1',channelId:'123',lastId});
const message=(id:number)=>({id,text:`original ${id}`,date:1700000000+id});
function database() {
  const sources=['source_alpha','source_beta'].map(handle=>({id:handle,handle,platform:'TELEGRAM',enabled:true,deletedAt:null,cursor:cursor(10),lastError:null as string|null}));
  const posts=new Map<string,Record<string,unknown>>(),jobs=new Set<string>();
  const controls={delayMs:0,failId:'',afterCommit:()=>{}};
  const settings={findUnique:async()=>({publishingMode:'REQUIRE_APPROVAL'})};
  const mock={
    source:{
      findMany:async()=>sources.filter(s=>s.enabled&&!s.deletedAt).map(s=>structuredClone(s)),
      update:async({where,data}:{where:{id:string};data:Record<string,unknown>})=>Object.assign(sources.find(s=>s.id===where.id)!,data),
    },
    appSettings:settings,
    $transaction:async(callback:(tx:unknown)=>Promise<unknown>)=>{
      const before=new Map(posts),beforeJobs=new Set(jobs);
      try {
        const result=await callback({
          source:{findUniqueOrThrow:async({where}:{where:{id:string}})=>sources.find(s=>s.id===where.id)!},
          appSettings:settings,
          sourcePost:{upsert:async({create}:{create:Record<string,unknown>})=>{
            if(controls.delayMs)await sleep(controls.delayMs);
            const key=`${create.sourceId}:${create.sourcePostId}`;
            if(!posts.has(key))posts.set(key,{...create,id:key});
            return posts.get(key);
          }},
          processingJob:{upsert:async({create}:{create:{sourcePostId:string}})=>{
            if(create.sourcePostId===controls.failId)throw Error('private database detail');
            jobs.add(create.sourcePostId);return create;
          }},
        });
        controls.afterCommit();return result;
      } catch(error) {
        posts.clear();for(const [k,v] of before)posts.set(k,v);
        jobs.clear();for(const k of beforeJobs)jobs.add(k);
        throw error;
      }
    },
  };
  return {db:mock as unknown as PrismaClient,sources,posts,jobs,controls};
}
function connections(history:Map<string,ReadMessage[]>,stuckFirst=false) {
  let created=0,closed=0,live=0,maxLive=0;
  const reads:string[]=[],events:string[]=[];
  const factory=():PollConnection=>{
    const generation=++created;let connected=false;
    const client={
      getEntity:async(handle:string)=>{
        if(stuckFirst&&generation===1)return new Promise<never>(()=>{});
        const entity=Object.create(Api.Channel.prototype);
        Object.assign(entity,{id:123,broadcast:true,username:handle});return entity;
      },
      getMessages:async(handle:string,options:{minId?:number;limit:number})=>{
        reads.push(handle);
        return (history.get(handle)??[]).filter(m=>m.id>(options.minId??0)).slice(0,options.limit)
          .map(m=>({id:m.id,message:m.text,date:m.date}));
      },
    } as unknown as TelegramClient;
    const reader=new TelegramReader(client);
    return {
      get connected(){return connected;},
      connect:async()=>{connected=true;maxLive=Math.max(maxLive,++live);events.push(`connect:${generation}`);},
      authorize:async()=>{},
      close:async()=>{if(connected)live--;connected=false;closed++;events.push(`close:${generation}`);},
      channel:(h,s)=>reader.channel(h,s),messages:(h,a,s)=>reader.messages(h,a,s),
    };
  };
  return {factory,reads,events,counts:()=>({created,closed,maxLive})};
}

test('timeout closes old transport, next source reconnects, posts around disconnect and restart are ingested once',async()=>{
  const state=database();
  const history=new Map([['source_alpha',[message(11)]],['source_beta',[message(11)]]]);
  const transport=connections(history,true),progress:PollProgress[]=[];
  const worker=new TelegramPoller(transport.factory,{readMs:10,drainMs:100});
  const first=await pollSources(state.db,{TELEGRAM:worker},signal,{onProgress:p=>progress.push(p)});
  assert.equal(first[0].error,'TELEGRAM_OPERATION_TIMEOUT');
  assert.equal(state.sources[0].cursor.lastId,10);
  assert.equal(first[1].error,null);assert.equal(worker.ready,true);
  assert.deepEqual(transport.events.slice(0,3),['connect:1','close:1','connect:2']);
  history.get('source_alpha')!.push(message(12));
  await pollSources(state.db,{TELEGRAM:worker},signal);
  await worker.close();
  const restarted=new TelegramPoller(transport.factory);
  await pollSources(state.db,{TELEGRAM:restarted},signal);
  assert.equal(state.posts.size,3);assert.equal(state.jobs.size,3);
  assert.equal(state.sources[0].cursor.lastId,12);assert.equal(transport.counts().maxLive,1);
  assert.ok(progress.some(p=>p.phase==='ERROR'&&p.error==='TELEGRAM_OPERATION_TIMEOUT'));
  assert.ok(progress.some(p=>p.phase==='COMPLETE'&&p.handle==='source_beta'));
  await restarted.close();
});

test('slow durable persistence exceeding network deadline completes before cursor and all sources progress',async()=>{
  const state=database();state.controls.delayMs=15;
  const history=new Map([['source_alpha',[message(11),message(12),message(13)]],['source_beta',[message(11)]]]);
  const transport=connections(history),worker=new TelegramPoller(transport.factory,{readMs:5});
  let commits=0;
  state.controls.afterCommit=()=>{
    commits++;
    if(commits<=3)assert.equal(state.sources[0].cursor.lastId,10,'cursor waits for complete durable page');
  };
  const reports=await pollSources(state.db,{TELEGRAM:worker},signal);
  assert.ok(reports.every(r=>!r.error));assert.equal(state.posts.size,4);
  assert.equal(state.sources[0].cursor.lastId,13);assert.equal(state.sources[1].cursor.lastId,11);
  assert.equal(transport.counts().closed,0,'slow DB must not disconnect healthy Telegram');
  await worker.close();
});

test('partial page DB failure preserves cursor; replay repairs job atomically without duplicates or lost posts',async()=>{
  const state=database();state.controls.failId='source_alpha:12';
  const history=new Map([['source_alpha',[message(11),message(12)]],['source_beta',[message(11)]]]);
  const transport=connections(history),worker=new TelegramPoller(transport.factory);
  const first=await pollSources(state.db,{TELEGRAM:worker},signal);
  assert.equal(first[0].error,'SOURCE_PERSIST_FAILED');assert.equal(first[1].error,null);
  assert.equal(state.sources[0].cursor.lastId,10);assert.equal(state.posts.has('source_alpha:12'),false);
  assert.equal(state.jobs.has('source_alpha:12'),false);assert.equal(transport.counts().closed,0);
  state.controls.failId='';history.get('source_alpha')!.push(message(13));
  await pollSources(state.db,{TELEGRAM:worker},signal);
  await pollSources(state.db,{TELEGRAM:worker},signal);
  assert.equal(state.sources[0].cursor.lastId,13);assert.equal(state.posts.size,4);assert.equal(state.jobs.size,4);
  await worker.close();
});

test('shutdown and lease loss between commits leave checkpoint replayable, enabled sources refreshed each cycle',async()=>{
  const state=database(),stop=new AbortController();
  const history=new Map([['source_alpha',[message(11),message(12)]],['source_beta',[message(11)]]]);
  const transport=connections(history),worker=new TelegramPoller(transport.factory);
  state.controls.afterCommit=()=>stop.abort();
  await assert.rejects(pollSources(state.db,{TELEGRAM:worker},stop.signal));
  assert.equal(state.sources[0].cursor.lastId,10);assert.equal(state.posts.size,1);
  state.controls.afterCommit=()=>{};state.sources[1].enabled=false;
  await pollSources(state.db,{TELEGRAM:worker},signal);
  assert.equal(state.posts.size,2);assert.equal(transport.reads.includes('source_beta'),false);
  state.sources[1].enabled=true;
  await assert.rejects(pollSources(state.db,{TELEGRAM:worker},signal,{requireActive:()=>{throw new ProcessingError('WORKER_LEASE_LOST');}}),/WORKER_LEASE_LOST/);
  await pollSources(state.db,{TELEGRAM:worker},signal);
  assert.equal(state.posts.size,3);await worker.close();
});

test('pre-aborted reader never issues an RPC and failed transport drain forbids a replacement',async()=>{
  let calls=0;
  const reader=new TelegramReader({getEntity:async()=>{calls++;},getMessages:async()=>{calls++;}} as unknown as TelegramClient);
  await assert.rejects(reader.channel('source_alpha',AbortSignal.abort()));
  await assert.rejects(reader.messages('source_alpha',10,AbortSignal.abort()));
  assert.equal(calls,0);
  let factories=0;
  const worker=new TelegramPoller(()=>{factories++;return {
    connected:true,connect:async()=>{},authorize:async()=>{},close:()=>new Promise(()=>{}),
    channel:()=>new Promise(()=>{}),messages:async()=>[],
  };},{readMs:5,drainMs:5});
  await assert.rejects(worker.poll({handle:'source_alpha',cursor:cursor(10)},signal),/WORKER_DRAIN_FAILED/);
  await assert.rejects(worker.poll({handle:'source_alpha',cursor:cursor(10)},signal),/WORKER_DRAIN_FAILED/);
  assert.equal(factories,1);assert.equal(worker.ready,false);
});
