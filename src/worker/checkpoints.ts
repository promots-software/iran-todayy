import {sourceLanguage} from '../lib/processing/source-language';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {ProcessingError,type LanguageProvider} from '../lib/processing/contracts';
import {json} from '../lib/processing/engine';
import {failurePolicy} from '../lib/processing/failure-policy';

export interface CheckpointStore {
  load(key:string):Promise<{output:unknown}|{pending:true}|null>;
  start(key:string):Promise<void>;
  finish(key:string,output:unknown):Promise<void>;
  fail?(key:string,code:string,replaySafe:boolean):Promise<void>;
}
export async function checkpointCall<T>(store:CheckpointStore,key:string,call:()=>Promise<T>):Promise<T>{
 const previous=await store.load(key);
 if(previous&&'output' in previous)return structuredClone(previous.output) as T;
 if(previous)throw new ProcessingError('PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW');
 await store.start(key);
 try {const output=await call();await store.finish(key,output);return output;}
 catch(error){const code=error instanceof ProcessingError?error.code:'WORKER_INTERRUPTED';await store.fail?.(key,code,failurePolicy(code,1).safeCheckpointRetry);throw error;}
}
/** Persist outputs outside the event transaction. Every replay still passes the
 * existing engine validators. An interrupted provider stage is never blindly
 * repeated: its charge/result may be unknown, so an operator must reconcile it. */
export function checkpointProvider(provider:LanguageProvider, store:CheckpointStore):LanguageProvider {
  async function stage<T>(name:string,input:unknown,signal:AbortSignal,call:()=>Promise<T>):Promise<T> {
    signal.throwIfAborted();
    const context=input as {processingMode?:string;content?:string};
    const directBilingual=name==='understand'&&context.processingMode==='DIRECT'&&typeof context.content==='string'&&sourceLanguage(context.content)!=='ar';
    const key=createHash('sha256').update(JSON.stringify([directBilingual?'worker-direct-bilingual-v1':name==='draft'?'worker-local-draft-v2':'worker-checkpoint-v1',provider.id,name,input])).digest('hex');
    return checkpointCall(store,key,call);
  }
  return {
    id:provider.id,live:provider.live,draftOnlyAccepted:provider.draftOnlyAccepted,constrainedRewrite:provider.constrainedRewrite,
    understand:(input,signal)=>stage('understand',input,signal,()=>provider.understand(input,signal)),
    compare:(input,signal)=>stage('compare',input,signal,()=>provider.compare(input,signal)),
    draft:(input,signal)=>stage('draft',input,signal,()=>provider.draft(input,signal)),
  };
}
export function databaseCheckpoints(db:PrismaClient,postId:string):CheckpointStore {
  return {
    async load(key) {
      const where={entityType:'SourcePost',entityId:postId,metadata:{path:['key'],equals:key}};
      const complete=await db.auditLog.findFirst({where:{...where,action:'WORKER_PROVIDER_STAGE_COMPLETED'},orderBy:{createdAt:'desc'}});
      if (complete) return {output:(complete.metadata as {output:unknown}).output};
      const latest=await db.auditLog.findFirst({where:{...where,action:{in:['WORKER_PROVIDER_STAGE_STARTED','WORKER_PROVIDER_STAGE_FAILED']}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
      if(latest?.action==='WORKER_PROVIDER_STAGE_FAILED'&&(latest.metadata as {replaySafe?:boolean})?.replaySafe===true)return null;
      return latest ? {pending:true} : null;
    },
    async start(key) {
      await db.$transaction(async tx=>{
        // Serialize the intent check/write across workers, without holding a DB
        // transaction over a network call. A competing intent never executes.
        const operation=postId+':'+key;
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${operation}, 0))`;
        const latest=await tx.auditLog.findFirst({where:{entityType:'SourcePost',entityId:postId,metadata:{path:['key'],equals:key},action:{in:['WORKER_PROVIDER_STAGE_STARTED','WORKER_PROVIDER_STAGE_COMPLETED','WORKER_PROVIDER_STAGE_FAILED']}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
        if(latest&&!(latest.action==='WORKER_PROVIDER_STAGE_FAILED'&&(latest.metadata as {replaySafe?:boolean}).replaySafe===true))throw new ProcessingError('PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW');
        await tx.auditLog.create({data:{action:'WORKER_PROVIDER_STAGE_STARTED',actor:'production-worker',entityType:'SourcePost',entityId:postId,message:'Provider stage intent; reconcile incomplete attempts before replay',metadata:json({key})}});
      });
    },
    async finish(key,output) {await db.auditLog.create({data:{action:'WORKER_PROVIDER_STAGE_COMPLETED',actor:'production-worker',entityType:'SourcePost',entityId:postId,message:'Checkpoint for restart; validation remains mandatory on replay',metadata:json({key,output})}});},
    async fail(key,code,replaySafe){await db.auditLog.create({data:{action:'WORKER_PROVIDER_STAGE_FAILED',actor:'production-worker',entityType:'SourcePost',entityId:postId,message:'Failed request retained; only definite retry-safe failures may resume',metadata:json({key,code,replaySafe})}});},
  };
}
