import type {PrismaClient} from '@prisma/client';
import {ProcessingError} from '../processing/contracts';
import {assertSendEnabled,readPublisherEnv} from './publisher';
import {automaticDeliveryCycle} from './automatic-delivery';
export {publicationReady as eligibleDirectPublication} from './publication-policy';
/** Compatibility only: old callers now use the SAME runtime policy and exclusions. */
export function assertDirectAutoEnabled(env:Record<string,string|undefined>){
 if(env.AUTO_PUBLISH!=='true'||env.REQUIRE_APPROVAL!=='true')throw new ProcessingError('DIRECT_AUTO_DISABLED');
 assertSendEnabled(env);readPublisherEnv(env);
}
export async function publishReadyDirect(db:PrismaClient,id:string,env:Record<string,string|undefined>,transport:typeof fetch=fetch){
 assertDirectAutoEnabled(env);
 const result=await automaticDeliveryCycle(db,env,transport,id);
 return result.status==='NO_ELIGIBLE_STORY'||result.status==='DISABLED'?{status:'NOT_ELIGIBLE' as const}:result;
}
