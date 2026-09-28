import {ProcessingError} from './processing/contracts';
type Environment=Record<string,string|undefined>;
/** Explicit deployment identity, never inferred from a channel or credentials. */
export function canonicalPipelineEnabled(env:Environment=process.env){
 return env.IRAN_TODAY_ENVIRONMENT==='staging'||env.IRAN_TODAY_ENVIRONMENT==='production';
}
export function usesCanonicalPipeline(provider:{live?:boolean;generationFirst?:boolean;canonicalRequest?:unknown},env:Environment=process.env){
 if(!canonicalPipelineEnabled(env))return false;
 const capable=provider.generationFirst===true&&typeof provider.canonicalRequest==='function';
 if(provider.live&&!capable)throw new ProcessingError('CANONICAL_PROVIDER_REQUIRED');
 return capable;
}
export function assertCanonicalEnvironment(env:Environment=process.env){
 if(!canonicalPipelineEnabled(env))throw new ProcessingError('CANONICAL_ENVIRONMENT_REQUIRED');
}
