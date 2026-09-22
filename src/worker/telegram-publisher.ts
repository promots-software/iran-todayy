import {acknowledgePublisher} from './publisher-acknowledgement';
import {publisherDelay} from './database-cadence';
import {PrismaClient} from '@prisma/client';
import {automaticDeliveryCycle} from '../lib/telegram/automatic-delivery';
import {ProcessingError} from '../lib/processing/contracts';
import {setTimeout as sleep} from 'node:timers/promises';
const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
async function main(){const db=new PrismaClient();const startedAt=new Date();let dependencyFailures=0,status='IDLE',lastError:string|null=null,acknowledged:string|null=null;
 try{while(!stop.signal.aborted){
  try{
   acknowledged=await acknowledgePublisher(db,process.env,startedAt,status,lastError,publisherDelay(status,0),acknowledged);
   const result=await automaticDeliveryCycle(db,process.env,fetch,undefined,acknowledged);
   status=result.status;lastError=null;dependencyFailures=0;
   console.log(JSON.stringify({event:'TELEGRAM_DELIVERY_CYCLE',...result}));
  }catch(error){status='ERROR';lastError=error instanceof ProcessingError?error.code:'DELIVERY_DEPENDENCY_UNAVAILABLE';dependencyFailures++;console.error(JSON.stringify({event:'TELEGRAM_DELIVERY_STOPPED',code:lastError}));}
  await sleep(publisherDelay(status,dependencyFailures),undefined,{signal:stop.signal}).catch(()=>{});
 }}finally{await db.$disconnect();}}
main().catch(()=>{console.error('TELEGRAM_DELIVERY_WORKER_FAILED');process.exitCode=1;});
