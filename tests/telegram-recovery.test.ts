import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {Api, type TelegramClient} from 'teleproto';
import {TelegramReader, TelegramMonitor, type ReadMessage} from '../src/lib/telegram/monitor';
import {TelegramPoller, type PollConnection} from '../src/worker/telegram-poller';
import {pollSources, type PollProgress} from '../src/lib/processing/engine';
import {ProcessingError} from '../src/lib/processing/contracts';
import {providerAdmissionDelay} from '../src/worker/provider-guard';
import {readFileSync} from 'node:fs';

const signal=new AbortController().signal;
const cursor=(lastId:number)=>({kind:'telegram-shadow-v1',channelId:'123',lastId});
const message=(id:number)=>({id,text:`original ${id}`,date:1700000000+id});
function database() {
  const sources=['source_alpha','source_beta'].map(handle=>({id:handle,handle,platform:'TELEGRAM',enabled:true,deletedAt:null,cursor:cursor(10),lastError:null as string|null}));
  const posts=new Map<string,Record<string,unknown>>(),jobs=new Set<string>();
  const controls={delayMs:0,failId:'',failCursorAt:0,afterCommit:()=>{},afterCursorCommit:()=>{}};
  const settings={findUnique:async()=>({publishingMode:'REQUIRE_APPROVAL'})};
  const mock={
    source:{
      findMany:async()=>sources.filter(s=>s.enabled&&!s.deletedAt).map(s=>structuredClone(s)),
      update:async({where,data}:{where:{id:string};data:Record<string,unknown>})=>{
        if(data.cursor&&controls.failCursorAt===(data.cursor as {lastId:number}).lastId)throw Error('offline checkpoint persistence failure');
        const source=Object.assign(sources.find(s=>s.id===where.id)!,data);
        if(data.cursor)controls.afterCursorCommit();return source;
      },
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
function connections(history:Map<string,ReadMessage[]>,stuckFirst=false,pageCeiling=50) {
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
        return (history.get(handle)??[]).filter(m=>m.id>(options.minId??0)).slice(0,Math.min(options.limit,pageCeiling))
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


for(const pageSize of [1,7,50])for(const size of [...new Set([0,1,pageSize-1,pageSize,pageSize+1,pageSize*2+3,501,1507])]){
 test(`burst invariant: ${size} messages with API pages up to ${pageSize}, no per-cycle cap`,async()=>{
  const state=database();
  const messages=Array.from({length:size},(_,i)=>message(11+i*2)); // Real IDs need not be contiguous.
  const history=new Map([['source_alpha',messages],['source_beta',[message(11)]]]);
  const transport=connections(history,false,pageSize),worker=new TelegramPoller(transport.factory);
  state.controls.afterCursorCommit=()=>{
   for(const source of state.sources)for(const m of history.get(source.handle)!.filter(m=>m.id<=source.cursor.lastId)){
    assert.ok(state.posts.has(source.id+':'+m.id),'cursor must not cover an unpersisted available message');
    assert.ok(state.jobs.has(source.id+':'+m.id),'every covered message has a job');
   }
  };
  const result=await pollSources(state.db,{TELEGRAM:worker},signal);
  assert.ok(result.every(r=>!r.error));assert.equal(state.posts.size,size+1);assert.equal(state.jobs.size,size+1);
  assert.equal(state.sources[0].cursor.lastId,messages.at(-1)?.id??10);
  if(size>pageSize)assert.deepEqual(transport.reads.slice(0,3),['source_alpha','source_beta','source_alpha'],'pages rotate between sources');
  await pollSources(state.db,{TELEGRAM:worker},signal);assert.equal(state.posts.size,size+1);await worker.close();
 });
}

test('partial later page failure and restart retain prior page checkpoint and all originals',async()=>{
 const state=database(),history=new Map([['source_alpha',Array.from({length:131},(_,i)=>message(i+11))],['source_beta',[message(11)]]]);
 state.controls.failId='source_alpha:73';const transport=connections(history),worker=new TelegramPoller(transport.factory);
 const failed=await pollSources(state.db,{TELEGRAM:worker},signal);assert.equal(failed[0].error,'SOURCE_PERSIST_FAILED');
 assert.equal(state.sources[0].cursor.lastId,60);assert.equal(state.jobs.has('source_alpha:72'),true);assert.equal(state.posts.has('source_alpha:73'),false);
 await worker.close();state.controls.failId='';history.get('source_alpha')!.push(message(142));
 const restarted=new TelegramPoller(transport.factory);await pollSources(state.db,{TELEGRAM:restarted},signal);
 assert.equal(state.posts.size,133);assert.equal(state.jobs.size,133);assert.equal(state.sources[0].cursor.lastId,142);
 for(const m of history.get('source_alpha')!)assert.equal(state.posts.get('source_alpha:'+m.id)!.originalContent,m.text);
 await restarted.close();
});

test('checkpoint failure before write or lost acknowledgement after write is replay-safe',async()=>{
 for(const afterWrite of [false,true]){
  const state=database(),history=new Map([['source_alpha',Array.from({length:111},(_,i)=>message(i+11))],['source_beta',[message(11)]]]);
  const transport=connections(history),worker=new TelegramPoller(transport.factory);
  if(afterWrite){let fired=false;state.controls.afterCursorCommit=()=>{if(!fired){fired=true;throw Error('lost acknowledgement');}};}else state.controls.failCursorAt=60;
  await pollSources(state.db,{TELEGRAM:worker},signal);
  assert.equal(state.sources[0].cursor.lastId,afterWrite?60:10);assert.equal(state.jobs.has('source_alpha:60'),true);
  state.controls.failCursorAt=0;state.controls.afterCursorCommit=()=>{};await worker.close();
  const restarted=new TelegramPoller(transport.factory);await pollSources(state.db,{TELEGRAM:restarted},signal);
  assert.equal(state.posts.size,112);assert.equal(state.jobs.size,112);assert.equal(state.sources[0].cursor.lastId,121);await restarted.close();
 }
});

test('arrivals during pagination and newly enabled sources are collected in following rounds',async()=>{
 const state=database();state.sources[1].enabled=false;
 const history=new Map([['source_alpha',Array.from({length:51},(_,i)=>message(i+11))],['source_beta',[message(11),message(12)]]]);
 const transport=connections(history),worker=new TelegramPoller(transport.factory);let added=false;
 state.controls.afterCursorCommit=()=>{if(!added){added=true;history.get('source_alpha')!.push(...Array.from({length:79},(_,i)=>message(i+62)));state.sources[1].enabled=true;}};
 await pollSources(state.db,{TELEGRAM:worker},signal);assert.equal(state.posts.size,132);assert.equal(state.jobs.size,132);assert.equal(state.sources[1].cursor.lastId,12);await worker.close();
});

test('no checkpoint never means skip history; media-only and service messages remain traceable',async()=>{
 const state=database();Object.assign(state.sources[0],{cursor:null});state.sources[1].enabled=false;
 const messages:ReadMessage[]=[{...message(1),text:'',hasMedia:true,hasPhoto:true},{...message(4),text:'',service:true},{...message(9),text:'  '},message(20)];
 const monitor=new TelegramMonitor({channel:async()=> '123',messages:async(_h,after)=>messages.filter(m=>m.id>(after??0)).slice(0,2)});
 await pollSources(state.db,{TELEGRAM:monitor},signal);assert.equal(state.posts.size,4);assert.equal(state.jobs.size,4);assert.equal(state.sources[0].cursor.lastId,20);
 assert.equal(state.posts.get('source_alpha:1')!.originalContent,'');assert.equal(state.posts.get('source_alpha:9')!.originalContent,'  ');
 await pollSources(state.db,{TELEGRAM:monitor},signal);assert.equal(state.posts.size,4);
});

test('non-advancing provider page fails closed rather than skipping or looping forever',async()=>{
 const state=database();state.sources[1].enabled=false;
 const monitor=new TelegramMonitor({channel:async()=> '123',messages:async()=>[message(10)]});
 const report=await pollSources(state.db,{TELEGRAM:monitor},signal);assert.equal(report[0].error,'TELEGRAM_CURSOR_STALLED');assert.equal(state.sources[0].cursor.lastId,10);assert.equal(state.posts.size,0);
});

for(const code of ['GEMINI_HTTP_429','GEMINI_HTTP_503','GEMINI_TRANSPORT_FAILED','PROVIDER_COOLDOWN','PROVIDER_REQUEST_LIMIT','PROVIDER_BUDGET_EXHAUSTED'])test(`processing hold ${code} does not throttle collection`,async()=>{
 const state=database();const now=Date.now();
 const rows=code.includes('LIMIT')||code.includes('BUDGET')?[{action:'PROVIDER_RESERVED',metadata:{usd:1},createdAt:new Date(now)}]:[{action:'PROVIDER_COOLDOWN',metadata:{code,until:now+3600000},createdAt:new Date(now)}];
 Object.assign(state.db,{auditLog:{findMany:async()=>rows}});
 assert.ok(await providerAdmissionDelay(state.db)>0,'processor remains held');
 const history=new Map([['source_alpha',Array.from({length:501},(_,i)=>message(i+11))],['source_beta',Array.from({length:103},(_,i)=>message(i+11))]]);
 const transport=connections(history),worker=new TelegramPoller(transport.factory);
 await pollSources(state.db,{TELEGRAM:worker},signal);assert.equal(state.posts.size,604);assert.equal(state.jobs.size,604);
 assert.ok(await providerAdmissionDelay(state.db)>0);await worker.close();
});

test('production runs ingestion and processing concurrently; admission limiter is processing-only',()=>{
 const worker=readFileSync('src/worker/production.ts','utf8');
 const ingestLoop=worker.slice(worker.indexOf('const ingestLoop='),worker.indexOf('const processingLoop='));
 assert.ok(ingestLoop.includes('pollSources('));assert.ok(!/providerAdmissionDelay|guardedTransport|processJob|jobIntervalMs/.test(ingestLoop));
 assert.ok(worker.includes('[heartbeat(),ingestLoop(),processingLoop()]'));
});

test('a continuously busy source cannot starve a caught-up source with later arrivals',async()=>{
 const state=database(),stop=new AbortController();let now=0,hotId=10,coldReads=0;
 const monitor=new TelegramMonitor({channel:async()=> '123',messages:async(handle,after)=>{
  if(handle==='source_alpha'){now+=10000;return [message(++hotId)];}
  coldReads++;
  return now>=30000&&after===10?[message(11)]:[];
 }});
 state.controls.afterCursorCommit=()=>{if(state.sources[1].cursor.lastId===11)stop.abort();};
 await pollSources(state.db,{TELEGRAM:monitor},stop.signal,{now:()=>now});
 assert.ok(coldReads>=2);assert.ok(state.posts.has('source_beta:11'));assert.ok(state.jobs.has('source_beta:11'));
 assert.ok(hotId<20,'cold source is revisited without waiting for hot source exhaustion');
});
