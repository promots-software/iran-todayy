import {PrismaClient} from '@prisma/client';
import {automaticDeliveryCycle} from '../lib/telegram/automatic-delivery';
import {ProcessingError} from '../lib/processing/contracts';
import {setTimeout as sleep} from 'node:timers/promises';
const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
async function main(){const db=new PrismaClient();const startedAt=new Date();try{while(!stop.signal.aborted){
 let status='IDLE',lastError:string|null=null;
 try{const result=await automaticDeliveryCycle(db,process.env);status=result.status;console.log(JSON.stringify({event:'TELEGRAM_DELIVERY_CYCLE',...result}));}
 catch(error){status='ERROR';lastError=error instanceof ProcessingError?error.code:'DELIVERY_DEPENDENCY_UNAVAILABLE';console.error(JSON.stringify({event:'TELEGRAM_DELIVERY_STOPPED',code:lastError}));}
 try{await db.workerHeartbeat.upsert({where:{id:'telegram-publisher-worker'},create:{id:'telegram-publisher-worker',state:lastError?'ERROR':'IDLE',phase:'PUBLISHING',startedAt,lastSeenAt:new Date(),intervalMs:5000,metadata:{status}},update:{state:lastError?'ERROR':'IDLE',phase:'PUBLISHING',startedAt,lastSeenAt:new Date(),lastError,metadata:{status,autoPublish:process.env.AUTO_PUBLISH==='true',shadowMode:process.env.SHADOW_MODE!=='false',requireApproval:process.env.REQUIRE_APPROVAL!=='false',externalPublishingEnabled:process.env.TELEGRAM_PUBLISH_ENABLED==='true',commit:process.env.RAILWAY_GIT_COMMIT_SHA??null}}});}catch{console.error(JSON.stringify({event:'TELEGRAM_DELIVERY_HEARTBEAT_UNAVAILABLE'}));}
 await sleep(5000,undefined,{signal:stop.signal}).catch(()=>{});
 }}finally{await db.$disconnect();}}
main().catch(()=>{console.error('TELEGRAM_DELIVERY_WORKER_FAILED');process.exitCode=1;});
