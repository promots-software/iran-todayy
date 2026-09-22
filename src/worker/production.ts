import {processingLanes} from './newsroom-scheduler';
import {idleClaimMs} from './database-cadence';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {PrismaClient} from '@prisma/client';
import {Api} from 'teleproto';
import {createTelegramClient} from '../lib/telegram/client';
import {TelegramReader} from '../lib/telegram/monitor';
import {TelegramPoller} from './telegram-poller';
import {claimJob,processJob,pollSources,json} from '../lib/processing/engine';
import {ProcessingError} from '../lib/processing/contracts';
import {assertApprovalMode} from '../lib/processing/shadow';
import {GeminiLanguageProvider} from '../lib/processing/gemini';
import {checkpointProvider,databaseCheckpoints} from './checkpoints';
import {guardedTransport,providerCapacitySnapshot,costWaitRecheckBefore} from './provider-guard';
import {latencySnapshot} from './latency';
import {acquireLease,renewLease,releaseLease,workerId,heartbeatMs,workerConfig,assertWorkerSafety,safeWorkerError,backoff,pause,healthStatus,probeAuthorization,TelegramStartupError} from './runtime';

const stop=new AbortController();
const runId=randomUUID();
let shutdownTimer:ReturnType<typeof setTimeout>|undefined;
function log(event:string,fields:Record<string,unknown>={}) {
  console.log(JSON.stringify({time:new Date().toISOString(),worker:workerId,runId,event,...fields}));
}
function shutdown() {
  if (stop.signal.aborted) return;
  log('WORKER_STOPPING');stop.abort();
  // Below Railway's 60-second drain and well below the 90-second leader lease.
  shutdownTimer=setTimeout(()=>{log('WORKER_SHUTDOWN_DEADLINE');process.exit(1);},45000);
  shutdownTimer.unref();
}
process.once('SIGINT',shutdown);
process.once('SIGTERM',shutdown);

async function main() {
  const config=workerConfig();
  const db=new PrismaClient({datasourceUrl:config.databaseUrl});
  let lastDatabaseCheck=0,role='starting',fatal=false;
  let processingCapacity:Awaited<ReturnType<typeof providerCapacitySnapshot>>|null=null;
  const server=createServer((req,res)=>{
    if(req.url!=='/healthz'){res.writeHead(404).end();return;}
    const status=healthStatus(lastDatabaseCheck,stop.signal.aborted);
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({status:status===200?'ok':'unavailable',role,processingState:processingCapacity?.state??'UNKNOWN',publishingEnabled:false}));
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'0.0.0.0',resolve);});
  // A DB stall must terminate the old holder before its lease can be taken over.
  const watchdog=setInterval(()=>{
    if(role==='active' && lastDatabaseCheck && Date.now()-lastDatabaseCheck>60000){log('WORKER_DATABASE_WATCHDOG');process.exit(1);}
  },5000);
  watchdog.unref();
  async function safety() {
    assertWorkerSafety();
    assertApprovalMode((await db.appSettings.findUniqueOrThrow({where:{id:1},select:{publishingMode:true}})).publishingMode);
  }
  let failures=0;
  log('WORKER_STARTING',{provider:'gemini-3.1-flash-lite',shadowMode:true,requireApproval:true,autoPublish:false});
  try {
    while(!stop.signal.aborted) {
      let owned=false,poller:TelegramPoller|undefined;
      const cycle=new AbortController();
      const signal=AbortSignal.any([stop.signal,cycle.signal]);
      let lastRenewed=0,pollErrors=0;
      const processing=new Map<number,number>();
      let pollPhase='IDLE',activeSource:string|null=null,lastPollError:string|null=null,lastPollCompletedAt:string|null=null;
      try {
        await safety();
        owned=await acquireLease(db,runId);
        lastDatabaseCheck=Date.now();
        if(!owned) {
          // Healthy standby allows Railway to drain the old deployment. It does
          // not authenticate Telegram, poll sources, claim jobs or call AI.
          role='standby';log('WORKER_STANDBY');
          await pause(heartbeatMs,signal);continue;
        }
        role='active';lastRenewed=Date.now();
        await db.auditLog.create({data:{action:'WORKER_STARTED',entityType:'WorkerHeartbeat',entityId:workerId,message:'Telegram ingestion and Gemini processing; publishing disabled',metadata:json({runId})}});
        log('WORKER_LEASE_ACQUIRED');
        const requireLease=()=>{
          signal.throwIfAborted();
          if(Date.now()-lastRenewed>=60000)throw new ProcessingError('WORKER_LEASE_LOST');
        };
        poller=new TelegramPoller(()=>{
          const client=createTelegramClient();client.onError=async()=>{};
          const reader=new TelegramReader(client);
          return {
            get connected(){return client.connected;},
            // connect() itself invokes Telegram RPCs; auth-key failures can
            // occur here before GetState. Classify them without logging secrets.
            connect:async()=>{await probeAuthorization(()=>client.connect());},
            authorize:()=>probeAuthorization(()=>client.invoke(new Api.updates.GetState())),
            close:()=>client.destroy(),
            channel:(handle,readSignal)=>{requireLease();return reader.channel(handle,readSignal);},
            messages:(handle,after,readSignal)=>{requireLease();return reader.messages(handle,after,readSignal);},
          };
        },{requireActive:requireLease,log});
        const heartbeat=async()=>{
          while(!signal.aborted){
            requireLease();await safety();
            if([...processing.values()].some(start=>Date.now()-start>210000))throw new ProcessingError('WORKER_JOB_DEADLINE');
            const telegramReady=poller!.ready;
            const processingPaused=(await db.appSettings.findUnique({where:{id:1},select:{processingPaused:true}}))?.processingPaused??false;
            await renewLease(db,runId,processing.size?'BUSY':telegramReady?'IDLE':'ERROR',{
              shadowMode:true,requireApproval:true,autoPublish:false,externalPublishingEnabled:false,
              telegramReady,processingCount:processing.size,liveMonitoringEnabled:telegramReady,processingEnabled:!processingPaused,pollErrors,provider:'gemini-3.1-flash-lite',
              pollPhase,activeSource,lastPollError,lastPollCompletedAt,
              processingCapacity,
              commit:/^[a-f0-9]{40}$/.test(process.env.RAILWAY_GIT_COMMIT_SHA??'')?process.env.RAILWAY_GIT_COMMIT_SHA:null,
            });
            lastRenewed=lastDatabaseCheck=Date.now();
            log('WORKER_HEARTBEAT',{telegramReady,processing:processing.size>0,processingCount:processing.size,processingState:processingCapacity?.state??'UNKNOWN',capacityReason:processingCapacity?.reason??null,pollErrors,pollPhase,activeSource,lastPollError,lastPollCompletedAt});
            await pause(heartbeatMs,signal);
          }
        };
        const ingestLoop=async()=>{
          let attempts=0;
          while(!signal.aborted){
            try {
              requireLease();await safety();
              pollErrors=0;
              const report=await pollSources(db,{TELEGRAM:poller!},signal,{
                requireActive:requireLease,
                onProgress:progress=>{
                  pollPhase=progress.phase;activeSource=progress.handle;
                  if(progress.error){pollErrors++;lastPollError=progress.error;}
                  if(progress.phase==='COMPLETE')lastPollCompletedAt=new Date().toISOString();
                  log('SOURCE_POLL',progress);
                },
              });
              pollPhase='IDLE';activeSource=null;
              pollErrors=report.filter(r=>r.error).length;
              if(!pollErrors){lastPollError=null;attempts=0;}
              await pause(pollErrors?Math.max(30000,backoff(++attempts)):30000,signal);
            } catch(error) {
              if(safeWorkerError(error)==='WORKER_DRAIN_FAILED'){log('WORKER_DRAIN_FAILED');process.exit(1);}
              if(signal.aborted)break;
              const code=safeWorkerError(error);
              if(['TELEGRAM_AUTHORIZATION_REQUIRED','TELEGRAM_SESSION_INVALID','TELEGRAM_SESSION_CONFLICT','TELEGRAM_CREDENTIALS_REQUIRED','SHADOW_MODE_REQUIRED','REQUIRE_APPROVAL_REQUIRED','PUBLISHING_MUST_BE_DISABLED','WORKER_LEASE_LOST'].includes(code))throw error;
              pollPhase='ERROR';pollErrors=Math.max(1,pollErrors);lastPollError=code;
              const delayMs=Math.max(backoff(++attempts),error instanceof TelegramStartupError?error.retryAfterMs:0);log('TELEGRAM_RETRY',{code,delayMs});await pause(delayMs,signal);
            }
          }
        };
        const processingLoop=async(lane:number)=>{
          let attempts=0;
          while(!signal.aborted){
            try {
              requireLease();await safety();
              // Local checks and checkpoint replay never wait for AI capacity.
              // Only an actual uncached network stage obtains provider capacity.
              const job=await claimJob(db,runId,new Date(),true,[],true,costWaitRecheckBefore(processingCapacity));
              if(!job){await pause(idleClaimMs,signal);continue;}
              processing.set(lane,Date.now());
              await db.auditLog.create({data:{action:'PROVIDER_JOB_ADMITTED',actor:workerId,entityType:'ProviderBudget',entityId:'gemini',message:'Bounded two-lane processing; durable fairness and per-request cost protection'}});
              const provider=checkpointProvider(new GeminiLanguageProvider(config.geminiKey,guardedTransport(db,job.sourcePostId,async(url,init)=>{
                requireLease();await safety();
                return fetch(url,init);
              }),async usage=>{
                const processingMode=(await db.auditLog.findFirst({where:{entityType:'SourcePost',entityId:job.sourcePostId,action:'PROCESSING_ATTEMPT_STARTED'},orderBy:[{createdAt:'desc'},{id:'desc'}]}))?.metadata as {processingMode?:string}|null;
                const measured={...usage,processingMode:processingMode?.processingMode??'NORMAL'};
                log('AI_STAGE_USAGE',{postId:job.sourcePostId,...measured});
                await db.auditLog.create({data:{action:'AI_STAGE_USAGE',actor:workerId,entityType:'SourcePost',entityId:job.sourcePostId,message:'Provider token/cost accounting',metadata:json(measured)}});
              }),databaseCheckpoints(db,job.sourcePostId));
              const outcome=await processJob(db,job,provider,AbortSignal.any([signal,AbortSignal.timeout(180000)]));
              processing.delete(lane);attempts=0;
              log('JOB_FINISHED',outcome);
              // Next admission is governed by durable throughput, request/cost
              // limits and provider cooldown, not a blanket story-error penalty.
            } catch(error) {
              processing.delete(lane);
              if(signal.aborted)break;
              const code=safeWorkerError(error);
              if(['SHADOW_MODE_REQUIRED','REQUIRE_APPROVAL_REQUIRED','PUBLISHING_MUST_BE_DISABLED','WORKER_LEASE_LOST'].includes(code))throw error;
              const delayMs=Math.min(5000,backoff(++attempts));log('PROCESSING_RETRY',{code,delayMs});await pause(delayMs,signal);
            }
          }
        };
        let firstFailure:unknown;
        const observe=async()=>{while(!signal.aborted){try{processingCapacity=await providerCapacitySnapshot(db);const metrics=await latencySnapshot(db);log(metrics.alerts.length||processingCapacity.state==='CAPACITY_WAIT'?'PROCESSING_SLO_ALERT':'PROCESSING_SLO',{...metrics,activeLanes:processing.size,provider:processingCapacity});}catch{if(!signal.aborted)log('PROCESSING_METRICS_UNAVAILABLE');}await pause(30000,signal);}};
        const tasks=[heartbeat(),ingestLoop(),...processingLanes(processingLoop),observe()].map(async task=>{try{await task;}catch(e){if(!cycle.signal.aborted)firstFailure=e;cycle.abort();throw e;}});
        await Promise.allSettled(tasks);
        if(firstFailure)throw firstFailure;
      } catch(error) {
        if(!stop.signal.aborted){
          const code=safeWorkerError(error);log('WORKER_CYCLE_STOPPED',{code});
          fatal=['TELEGRAM_AUTHORIZATION_REQUIRED','TELEGRAM_SESSION_INVALID','TELEGRAM_SESSION_CONFLICT','TELEGRAM_CREDENTIALS_REQUIRED','SHADOW_MODE_REQUIRED','REQUIRE_APPROVAL_REQUIRED','PUBLISHING_MUST_BE_DISABLED'].includes(code);
        }
      } finally {
        cycle.abort();
        // Release ownership only after both loops drained and Telegram closed.
        if(poller)await poller.close().catch(()=>{log('TELEGRAM_CLOSE_FAILED');process.exit(1);});
        if(owned)await releaseLease(db,runId).catch(()=>log('WORKER_RELEASE_FAILED'));
      }
      if(fatal){process.exitCode=1;break;}
      if(!stop.signal.aborted){role='recovering';const delayMs=backoff(++failures);log('WORKER_RETRY',{delayMs});await pause(delayMs,stop.signal);}
    }
  } finally {
    clearInterval(watchdog);role='stopped';
    server.closeAllConnections();server.close();
    await db.$disconnect();
    log('WORKER_STOPPED');
  }
}
main().catch(error=>{if(!stop.signal.aborted){log('WORKER_FATAL',{code:safeWorkerError(error)});process.exitCode=1;}}).finally(()=>{if(shutdownTimer)clearTimeout(shutdownTimer);});
