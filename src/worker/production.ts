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
  const server=createServer((req,res)=>{
    if(req.url!=='/healthz'){res.writeHead(404).end();return;}
    const status=healthStatus(lastDatabaseCheck,stop.signal.aborted);
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({status:status===200?'ok':'unavailable',role,publishingEnabled:false}));
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'0.0.0.0',resolve);});
  // A DB stall must terminate the old holder before its lease can be taken over.
  const watchdog=setInterval(()=>{
    if(role==='active' && lastDatabaseCheck && Date.now()-lastDatabaseCheck>60000){log('WORKER_DATABASE_WATCHDOG');process.exit(1);}
  },5000);
  watchdog.unref();
  async function safety() {
    assertWorkerSafety();
    assertApprovalMode((await db.appSettings.findUniqueOrThrow({where:{id:1}})).publishingMode);
  }
  let failures=0;
  log('WORKER_STARTING',{provider:'gemini-3.1-flash-lite',shadowMode:true,requireApproval:true,autoPublish:false});
  try {
    while(!stop.signal.aborted) {
      let owned=false,poller:TelegramPoller|undefined;
      const cycle=new AbortController();
      const signal=AbortSignal.any([stop.signal,cycle.signal]);
      let lastRenewed=0,processingSince=0,pollErrors=0;
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
            connect:async()=>{await client.connect();},
            authorize:()=>probeAuthorization(()=>client.invoke(new Api.updates.GetState())),
            close:()=>client.destroy(),
            channel:(handle,readSignal)=>{requireLease();return reader.channel(handle,readSignal);},
            messages:(handle,after,readSignal)=>{requireLease();return reader.messages(handle,after,readSignal);},
          };
        },{requireActive:requireLease,log});
        const heartbeat=async()=>{
          while(!signal.aborted){
            requireLease();await safety();
            if(processingSince && Date.now()-processingSince>210000)throw new ProcessingError('WORKER_JOB_DEADLINE');
            const telegramReady=poller!.ready;
            await renewLease(db,runId,processingSince?'BUSY':telegramReady?'IDLE':'ERROR',{
              shadowMode:true,requireApproval:true,autoPublish:false,externalPublishingEnabled:false,
              liveMonitoringEnabled:telegramReady,processingEnabled:true,pollErrors,provider:'gemini-3.1-flash-lite',
              pollPhase,activeSource,lastPollError,lastPollCompletedAt,
            });
            lastRenewed=lastDatabaseCheck=Date.now();
            log('WORKER_HEARTBEAT',{telegramReady,processing:!!processingSince,pollErrors,pollPhase,activeSource,lastPollError,lastPollCompletedAt});
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
        const processingLoop=async()=>{
          let attempts=0;
          while(!signal.aborted){
            try {
              requireLease();await safety();
              if(!poller!.ready){await pause(5000,signal);continue;}
              const job=await claimJob(db,runId,new Date(),true);
              if(!job){await pause(5000,signal);continue;}
              processingSince=Date.now();
              const provider=checkpointProvider(new GeminiLanguageProvider(config.geminiKey,async(url,init)=>{
                requireLease();await safety();
                return fetch(url,init);
              },async usage=>{
                log('AI_STAGE_USAGE',{postId:job.sourcePostId,...usage});
                await db.auditLog.create({data:{action:'AI_STAGE_USAGE',actor:workerId,entityType:'SourcePost',entityId:job.sourcePostId,message:'Provider token/cost accounting',metadata:json(usage)}});
              }),databaseCheckpoints(db,job.sourcePostId));
              const outcome=await processJob(db,job,provider,AbortSignal.any([signal,AbortSignal.timeout(180000)]));
              processingSince=0;attempts=0;
              log('JOB_FINISHED',outcome);
              // A failed job retains its strict error/review state. Avoid rapidly
              // spending across the backlog during provider/configuration failures.
              if('error' in outcome)await pause(300000,signal);
            } catch(error) {
              processingSince=0;
              if(signal.aborted)break;
              const code=safeWorkerError(error);
              if(['SHADOW_MODE_REQUIRED','REQUIRE_APPROVAL_REQUIRED','PUBLISHING_MUST_BE_DISABLED','WORKER_LEASE_LOST'].includes(code))throw error;
              const delayMs=backoff(++attempts);log('PROCESSING_RETRY',{code,delayMs});await pause(delayMs,signal);
            }
          }
        };
        let firstFailure:unknown;
        const tasks=[heartbeat(),ingestLoop(),processingLoop()].map(async task=>{try{await task;}catch(e){if(!cycle.signal.aborted)firstFailure=e;cycle.abort();throw e;}});
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
