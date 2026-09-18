import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {acquireLease,renewLease,releaseLease,workerId,workerConfig,assertWorkerSafety,safeWorkerError,backoff,pause,deadline,drainedDeadline,healthStatus,probeAuthorization,TelegramStartupError} from '../src/worker/runtime';
import {checkpointProvider,databaseCheckpoints,type CheckpointStore} from '../src/worker/checkpoints';
import {ProcessingError,type LanguageProvider} from '../src/lib/processing/contracts';
import {claimJob,processJob,pollSources} from '../src/lib/processing/engine';
import {ruleSet} from '../src/lib/processing/rules';
import {unknownProfile} from '../src/lib/processing/contracts';
import {createTelegramClient} from '../src/lib/telegram/client';

const safe={SHADOW_MODE:'true',REQUIRE_APPROVAL:'true',AUTO_PUBLISH:'false',TELEGRAM_PUBLISH_ENABLED:'false'};
const signal=new AbortController().signal;
test('production requires explicit safe modes and runtime secrets without a local env file',()=>{
  const env={...safe,DATABASE_URL:'postgresql://offline:offline@localhost/test',TELEGRAM_API_ID:'1',TELEGRAM_API_HASH:'offline',TELEGRAM_SESSION:'offline',GEMINI_API_KEY:'offline'};
  const config=workerConfig(env);assert.equal(config.geminiKey,'offline');assert.equal(config.port,3001);
  assert.equal(new URL(config.databaseUrl).searchParams.get('connection_limit'),'4');
  for(const name of Object.keys(safe)){
    assert.throws(()=>assertWorkerSafety({...safe,[name]:undefined}));
    assert.throws(()=>assertWorkerSafety({...safe,[name]:safe[name as keyof typeof safe]==='true'?'false':'true'}));
  }
  assert.throws(()=>workerConfig({...env,GEMINI_API_KEY:undefined}),/GEMINI_API_KEY_REQUIRED/);
  assert.throws(()=>workerConfig({...env,PORT:'bad'}),/WORKER_PORT_INVALID/);
  assert.equal(safeWorkerError(new Error('sensitive connection URL')),'WORKER_DEPENDENCY_UNAVAILABLE');
  assert.equal(safeWorkerError(new ProcessingError('WORKER_LEASE_LOST')),'WORKER_LEASE_LOST');
});
test('backoff is exponential/capped, pauses abort and operations have deadlines',async()=>{
  assert.equal(backoff(1,()=>1),1000);assert.equal(backoff(4,()=>1),8000);assert.equal(backoff(99,()=>1),300000);
  await assert.rejects(pause(60000,AbortSignal.abort()));
  await assert.rejects(deadline(new Promise(()=>{}),signal,5),/WORKER_OPERATION_TIMEOUT/);
  assert.equal(await deadline(Promise.resolve(7),signal,1000),7);
  assert.equal(healthStatus(1000,false,1001),200);assert.equal(healthStatus(1000,false,62000),503);
  assert.equal(healthStatus(1000,true,1001),503);assert.equal(healthStatus(0,false,1001),503);
});
test('poll timeout aborts and drains old work before retry, stalled drain fails closed',async()=>{
  const events:string[]=[];
  await assert.rejects(drainedDeadline(async signal=>{
    try {await pause(60000,signal);} finally {events.push('drained');}
  },async()=>{events.push('cancelled');},signal,5,1000),/WORKER_OPERATION_TIMEOUT/);
  assert.ok(events.includes('cancelled'));assert.ok(events.includes('drained'));
  await assert.rejects(drainedDeadline(()=>new Promise(()=>{}),async()=>{},signal,5,5),/WORKER_DRAIN_FAILED/);
});
test('Telegram authorization distinguishes network failure, flood wait and revoked/shared sessions',async()=>{
  await probeAuthorization(async()=>({}));
  await assert.rejects(probeAuthorization(async()=>{throw new Error('private network error');}),/TELEGRAM_CONNECT_FAILED/);
  for(const errorMessage of ['SESSION_REVOKED','AUTH_KEY_UNREGISTERED'])await assert.rejects(probeAuthorization(async()=>{throw {errorMessage};}),/TELEGRAM_AUTHORIZATION_REQUIRED/);
  await assert.rejects(probeAuthorization(async()=>{throw {errorMessage:'AUTH_KEY_DUPLICATED'};}),/TELEGRAM_SESSION_CONFLICT/);
  await assert.rejects(probeAuthorization(async()=>{throw {seconds:30,errorMessage:'secret'};}),e=>e instanceof TelegramStartupError && e.code==='TELEGRAM_FLOOD_WAIT' && e.retryAfterMs===31000);
});
test('malformed saved Telegram session fails with a safe actionable code before connecting',()=>{
  const values={SHADOW_MODE:'true',TELEGRAM_API_ID:'1',TELEGRAM_API_HASH:'a'.repeat(32),TELEGRAM_SESSION:'invalid-offline-session'};
  const original=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  try {Object.assign(process.env,values);assert.throws(()=>createTelegramClient(),/^Error: TELEGRAM_SESSION_INVALID$/);}
  finally {for(const [key,value] of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
function memoryStore():CheckpointStore {
  const values=new Map<string,{pending:true}|{output:unknown}>();
  return {load:async key=>values.get(key)??null,start:async key=>{values.set(key,{pending:true});},finish:async(key,output)=>{values.set(key,{output:structuredClone(output)});}};
}
const input={content:'source text',publishedAt:new Date(0),profile:unknownProfile,rules:ruleSet};
test('restart reuses identical successful provider stage, with no extra calls or mutable output alias',async()=>{
  let calls=0;
  const base:LanguageProvider={id:'offline-v1',live:false,understand:async()=>{calls++;return {text:'immutable'};},compare:async()=>null,draft:async()=>null};
  const store=memoryStore();
  await checkpointProvider(base,store).understand(input,signal);
  const replay=await checkpointProvider(base,store).understand(input,signal) as {text:string};replay.text='changed';
  assert.deepEqual(await checkpointProvider(base,store).understand(input,signal),{text:'immutable'});assert.equal(calls,1);
  await checkpointProvider(base,store).understand({...input,content:'new source'},signal);assert.equal(calls,2);
  await checkpointProvider({...base,id:'offline-v2'},store).understand(input,signal);assert.equal(calls,3);
});
test('uncertain provider attempt is held for review on restart, never automatically charged again',async()=>{
  let calls=0;
  const base:LanguageProvider={id:'offline',live:false,understand:async()=>{calls++;throw new Error('connection lost');},compare:async()=>null,draft:async()=>null};
  const store=memoryStore();
  await assert.rejects(checkpointProvider(base,store).understand(input,signal),/connection lost/);
  await assert.rejects(checkpointProvider(base,store).understand(input,signal),/PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW/);
  assert.equal(calls,1);
});
test('deployment starts Node directly and has no publisher or dashboard build',()=>{
  const docker=readFileSync('Dockerfile.worker','utf8');assert.ok(docker.includes('USER node'));
  assert.ok(docker.includes('CMD ["node", "--import", "tsx", "src/worker/production.ts"]'));
  assert.ok(!docker.includes('COPY . .'));assert.ok(!docker.includes('npm run build'));
  const worker=readFileSync('src/worker/production.ts','utf8');
  assert.ok(!/publishOne|sendMessage|TELEGRAM_BOT_TOKEN/.test(worker));
  assert.ok(readFileSync('.dockerignore','utf8').includes('.env'));
});

test('local database lease fences overlap, survives restart, and checkpoints persist', {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=process.env.TEST_DATABASE_URL!;assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
  const db=new PrismaClient({datasourceUrl:url});
  const suffix=Date.now().toString();const postId=`checkpoint-test-${suffix}`;
  try {
    await db.workerHeartbeat.deleteMany({where:{id:workerId}});
    const owners=await Promise.all([acquireLease(db,'first'),acquireLease(db,'second')]);
    assert.equal(owners.filter(Boolean).length,1);
    const winner=owners[0]?'first':'second',loser=owners[0]?'second':'first';
    await renewLease(db,winner,'BUSY',{test:true});
    const beat=await db.workerHeartbeat.findUniqueOrThrow({where:{id:workerId}});
    assert.ok(Math.abs(beat.lastSeenAt.getTime()-Date.now())<5000,'database-clock heartbeat uses UTC like Prisma timestamps');
    await db.workerHeartbeat.update({where:{id:workerId},data:{lastSeenAt:new Date()}});
    assert.equal(await acquireLease(db,loser),false,'fresh Prisma timestamps must not appear expired in a non-UTC database session');
    await assert.rejects(renewLease(db,loser,'IDLE',{}),/WORKER_LEASE_LOST/);
    await releaseLease(db,loser);assert.equal((await db.workerHeartbeat.findUniqueOrThrow({where:{id:workerId}})).state,'BUSY');
    await db.workerHeartbeat.update({where:{id:workerId},data:{lastSeenAt:new Date(Date.now()-100000)}});
    assert.equal(await acquireLease(db,loser),true);
    await assert.rejects(renewLease(db,winner,'BUSY',{}),/WORKER_LEASE_LOST/);
    await releaseLease(db,winner);assert.equal((await db.workerHeartbeat.findUniqueOrThrow({where:{id:workerId}})).state,'STARTING');
    await releaseLease(db,loser);assert.equal(await acquireLease(db,winner),true);
    const store=databaseCheckpoints(db,postId);assert.equal(await store.load('a'),null);
    await store.start('a');assert.deepEqual(await store.load('a'),{pending:true});
    await store.finish('a',{source:'same'});assert.deepEqual(await databaseCheckpoints(db,postId).load('a'),{output:{source:'same'}});
  } finally {
    await db.workerHeartbeat.deleteMany({where:{id:workerId}});
    await db.auditLog.deleteMany({where:{entityId:postId}});await db.$disconnect();
  }
});
test('source changes are read dynamically, polling cancellation retains cursor, and stale job spends zero provider calls',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=process.env.TEST_DATABASE_URL!;assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
  const db=new PrismaClient({datasourceUrl:url});const handle=`worker${Date.now()}`;
  const source=await db.source.create({data:{platform:'TELEGRAM',handle,name:'offline worker regression',url:`https://t.me/${handle}`}});
  let polls=0,calls=0;const prior=process.env.SHADOW_MODE;process.env.SHADOW_MODE='true';
  const monitor={id:'offline',live:false,poll:async(i:{handle:string})=>{if(i.handle===handle)polls++;return {posts:[],cursor:{seen:true}};}};
  try {
    await pollSources(db,{TELEGRAM:monitor},signal);assert.equal(polls,1);
    await db.source.update({where:{id:source.id},data:{enabled:false}});
    await pollSources(db,{TELEGRAM:monitor},signal);assert.equal(polls,1);
    await db.source.update({where:{id:source.id},data:{enabled:true,cursor: {before:true}}});
    const stop=new AbortController();
    await assert.rejects(pollSources(db,{TELEGRAM:{id:'offline-cancel',live:false,poll:async(i)=>{if(i.handle===handle)stop.abort();return {posts:[],cursor:{after:true}};}}},stop.signal));
    assert.deepEqual((await db.source.findUniqueOrThrow({where:{id:source.id}})).cursor,{before:true});
    const post=await db.sourcePost.create({data:{sourceId:source.id,sourcePostId:'1',sourceUrl:source.url,originalContent:'offline original',sourcePublishedAt:new Date()}});
    await db.processingJob.create({data:{sourcePostId:post.id,stage:'PROCESS_V1'}});
    const job=await claimJob(db,'first',new Date(),true);assert.ok(job);assert.equal(job.sourcePostId,post.id);
    await db.processingJob.update({where:{id:job.id},data:{lockedBy:'replacement-owner'}});
    const result=await processJob(db,job,{id:'offline',live:false,understand:async()=>{calls++;throw Error('must not run');},compare:async()=>null,draft:async()=>null},signal);
    assert.ok('error' in result);assert.equal(result.error,'STALE_CLAIM');assert.equal(calls,0);
    assert.equal((await db.processingJob.findUniqueOrThrow({where:{id:job.id}})).lockedBy,'replacement-owner');
  } finally {
    if(prior===undefined)delete process.env.SHADOW_MODE;else process.env.SHADOW_MODE=prior;
    await db.processingJob.deleteMany({where:{sourcePost:{sourceId:source.id}}});
    await db.sourcePost.deleteMany({where:{sourceId:source.id}});await db.source.delete({where:{id:source.id}});await db.$disconnect();
  }
});
