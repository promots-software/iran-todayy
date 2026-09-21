import {PrismaClient} from '@prisma/client';
import {setTimeout as pause} from 'node:timers/promises';
import {assertDirectAutoEnabled,publishReadyDirect} from '../lib/telegram/direct-auto';
import {ProcessingError} from '../lib/processing/contracts';
/** Optional, separate delivery service. Never runs from ingestion/processing.
 * No provider, Telegram USER session, or WEB delivery is used here. */
async function main(){
 assertDirectAutoEnabled(process.env);
 const db=new PrismaClient(),controller=new AbortController();
 process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
 try{while(!controller.signal.aborted){
  assertDirectAutoEnabled(process.env);
  let cursor:string|undefined;
  do {
  const items=await db.newsItem.findMany({where:{status:'PENDING_APPROVAL',validationStatus:'PASSED',error:null,humanDraft:null,publication:null,validationResult:{path:['processingMode'],equals:'DIRECT'}},select:{id:true},orderBy:{id:'asc'},take:20,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  for(const item of items){if(controller.signal.aborted)break;
   const result=await publishReadyDirect(db,item.id,process.env);
   console.log(JSON.stringify({event:'DIRECT_PUBLICATION_RESULT',candidateId:item.id,...result}));
   if(result.status==='UNKNOWN'||result.status==='FAILED')throw new ProcessingError('DIRECT_DELIVERY_RECONCILIATION_REQUIRED');
  }
  cursor=items.length===20?items.at(-1)!.id:undefined;
  }while(cursor&&!controller.signal.aborted);
  await pause(1000,undefined,{signal:controller.signal}).catch(()=>{});
 }}finally{await db.$disconnect();}
}
main().catch(error=>{console.error(JSON.stringify({event:'DIRECT_PUBLISHER_STOPPED',code:error instanceof ProcessingError?error.code:'DIRECT_PUBLISHER_FAILED'}));process.exitCode=1;});
