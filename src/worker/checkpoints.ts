import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {ProcessingError,type LanguageProvider} from '../lib/processing/contracts';
import {json} from '../lib/processing/engine';

export interface CheckpointStore {
  load(key:string):Promise<{output:unknown}|{pending:true}|null>;
  start(key:string):Promise<void>;
  finish(key:string,output:unknown):Promise<void>;
}
/** Persist outputs outside the event transaction. Every replay still passes the
 * existing engine validators. An interrupted provider stage is never blindly
 * repeated: its charge/result may be unknown, so an operator must reconcile it. */
export function checkpointProvider(provider:LanguageProvider, store:CheckpointStore):LanguageProvider {
  async function stage<T>(name:string,input:unknown,signal:AbortSignal,call:()=>Promise<T>):Promise<T> {
    signal.throwIfAborted();
    const key=createHash('sha256').update(JSON.stringify(['worker-checkpoint-v1',provider.id,name,input])).digest('hex');
    const previous=await store.load(key);
    if (previous && 'output' in previous) return structuredClone(previous.output) as T;
    if (previous) throw new ProcessingError('PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW');
    await store.start(key);
    const output=await call();
    await store.finish(key,output);
    return output;
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
      return await db.auditLog.findFirst({where:{...where,action:'WORKER_PROVIDER_STAGE_STARTED'}}) ? {pending:true} : null;
    },
    async start(key) {await db.auditLog.create({data:{action:'WORKER_PROVIDER_STAGE_STARTED',actor:'production-worker',entityType:'SourcePost',entityId:postId,message:'Provider stage intent; reconcile incomplete attempts before replay',metadata:json({key})}});},
    async finish(key,output) {await db.auditLog.create({data:{action:'WORKER_PROVIDER_STAGE_COMPLETED',actor:'production-worker',entityType:'SourcePost',entityId:postId,message:'Checkpoint for restart; validation remains mandatory on replay',metadata:json({key,output})}});},
  };
}
