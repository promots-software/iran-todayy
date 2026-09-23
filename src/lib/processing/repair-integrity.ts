import {ProcessingError} from './contracts';
import {resolveContextEvidence} from './groq-validation';
import type {StageRepair} from './normal-v2';
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const clone=<T>(v:T):T=>structuredClone(v);
/** Preserve each independently valid literal field. Invalid fields may be fixed;
 * new statements may be appended, but valid old assertions/speakers retain IDs.
 * This is a merge of data, never permission to skip full schema/coverage checks. */
export function preserveGroundedExtraction(previous:unknown,candidate:unknown,source:string){
 if(!record(previous)||!record(candidate))return candidate;
 const result=clone(candidate);
 const valid=(v:unknown)=>{if(!record(v)||typeof v.excerpt!=='string')return false;try{resolveContextEvidence(clone(v),source);return true;}catch{return false;}};
 for(const key of ['action','object','location','event_time'])if(valid(previous[key]))result[key]=clone(previous[key]);
 const oldActors=previous.actors,newActors=result.actors;
 if(Array.isArray(oldActors)&&Array.isArray(newActors))oldActors.forEach((v,i)=>{if(valid(v))newActors[i]=clone(v);});
 const oldFacts=previous.statements,newFacts=result.statements;
 if(Array.isArray(oldFacts)&&Array.isArray(newFacts))oldFacts.forEach((v,i)=>{
  if(!record(v))return;
  const next=record(newFacts[i])?newFacts[i] as Record<string,unknown>:{};
  if(valid(v.evidence))next.evidence=clone(v.evidence);
  if(valid(v.speaker))next.speaker=clone(v.speaker);
  if(Object.keys(next).length)newFacts[i]=next;
 });
 return result;
}
/** A draft repair may only change diagnosed paths. Its other fields are copied
 * from the original response, preventing unrelated factual/attribution deletion. */
export function mergeDiagnosedRepair(previous:unknown,candidate:unknown,repair:StageRepair){
 if(!record(previous)||!record(candidate))return candidate;
 const issues=Array.isArray(repair.issues)?repair.issues:[];
 const paths=issues.flatMap(i=>record(i)&&Array.isArray(i.path)&&i.path.length?[i.path as (string|number)[]]:[]);
 if(!paths.length)throw new ProcessingError('REPAIR_SCOPE_UNRESOLVED');
 const result=clone(previous);
 for(const path of paths){
  if(path.some(p=>['__proto__','constructor','prototype'].includes(String(p))))throw new ProcessingError('REPAIR_SCOPE_UNRESOLVED');
  let from:unknown=candidate,to:unknown=result;
  for(const part of path.slice(0,-1)){
   if(!from||typeof from!=='object'||!to||typeof to!=='object')throw new ProcessingError('REPAIR_SCOPE_UNRESOLVED');
   from=(from as Record<string|number,unknown>)[part];to=(to as Record<string|number,unknown>)[part];
  }
  const last=path.at(-1)!;
  if(!from||typeof from!=='object'||!to||typeof to!=='object')throw new ProcessingError('REPAIR_SCOPE_UNRESOLVED');
  (to as Record<string|number,unknown>)[last]=clone((from as Record<string|number,unknown>)[last]);
 }
 return result;
}
