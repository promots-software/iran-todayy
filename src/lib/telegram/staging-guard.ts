import {ProcessingError} from '../processing/contracts';
/** Staging cannot deliver anywhere except its explicitly verified channel. */
export function assertStagingDestination(env:Record<string,string|undefined>){
 if(env.IRAN_TODAY_ENVIRONMENT==='production'&&env.TELEGRAM_CHAT_ID!=='-1004297263933')throw new ProcessingError('PRODUCTION_DESTINATION_REJECTED');
 if(env.IRAN_TODAY_ENVIRONMENT!=='staging')return;
 if(env.TELEGRAM_CHAT_ID!=='-1004436536617')throw new ProcessingError('STAGING_DESTINATION_REJECTED');
}
