import {scopePreserved} from './targeted-repair';
import {ProcessingError} from './contracts';
import {resolveContextEvidence} from './groq-validation';
import type {StageRepair} from './normal-v2';
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const clone=<T>(v:T):T=>structuredClone(v);
/** Preserve grounded occurrence identity, never array position or unvalidated
 * prose. Reordered facts keep their local IDs; coverage IDs follow the mapping.
 * Missing/changed grounded facts fail rather than being silently reinserted. */
export function preserveGroundedExtraction(previous:unknown,candidate:unknown,source:string){
 if(!record(previous)||!record(candidate))return candidate;
 const result=clone(candidate);
 const identity=(v:unknown):string|null=>{
  if(!record(v)||typeof v.excerpt!=='string')return null;
  try{const e=clone(v);resolveContextEvidence(e,source);return JSON.stringify([e.start,e.end,e.excerpt]);}catch{return null;}
 };
 const fail=():never=>{throw new ProcessingError('REPAIR_GROUNDED_IDENTITY_CHANGED');};
 for(const key of ['action','object','location','event_time']){
  const before=identity(previous[key]);
  if(before&&identity(result[key])!==before)fail();
 }
 function reorder(old:unknown[],next:unknown[],get:(v:unknown)=>string|null,compatible=(a:unknown,b:unknown)=>get(a)===get(b)){
  const remaining=next.map((value,index)=>({value,index}));
  const fixed=new Map<number,{value:unknown;index:number}>();
  old.forEach((value,index)=>{
   const key=get(value);if(!key)return;
   const matches=remaining.map((entry,i)=>get(entry.value)&&compatible(value,entry.value)?i:-1).filter(i=>i>=0);
   if(matches.length!==1)fail();
   fixed.set(index,remaining.splice(matches[0],1)[0]);
  });
  const ordered:{value:unknown;index:number}[]=[];
  for(let i=0;i<old.length;i++){
   const entry=fixed.get(i)??remaining.shift();
   if(!entry)return fail();
   ordered.push(entry);
  }
  return [...ordered,...remaining];
 }
 if(Array.isArray(previous.actors)&&Array.isArray(result.actors))result.actors=reorder(previous.actors,result.actors,identity).map(e=>e.value);
 if(Array.isArray(previous.statements)&&Array.isArray(result.statements)){
  const factIdentity=(v:unknown)=>{
   if(!record(v))return null;
   const fact=identity(v.evidence);if(!fact)return null;
   const speaker=v.speaker===null?null:identity(v.speaker);
   if(v.speaker!==null&&!speaker)return null;
   return JSON.stringify([fact,speaker]);
  };
  const containsSameOccurrence=(a:unknown,b:unknown)=>{
   if(!record(a)||!record(b)||!factIdentity(a)||!factIdentity(b))return false;
   if((a.speaker===null)!==(b.speaker===null)||identity(a.speaker)!==identity(b.speaker))return false;
   const old=JSON.parse(identity(a.evidence)!) as [number,number,string];
   const next=JSON.parse(identity(b.evidence)!) as [number,number,string];
   // A repair may enlarge a contiguous verbatim excerpt to restore omitted
   // material around the SAME occurrence. It may not shrink/delete that fact.
   return next[0]<=old[0]&&next[1]>=old[1];
  };
  const ordered=reorder(previous.statements,result.statements,factIdentity,containsSameOccurrence);
  const remap=new Map(ordered.map((entry,index)=>[`f${entry.index+1}`,`f${index+1}`]));
  result.statements=ordered.map(entry=>entry.value);
  if(Array.isArray(result.coverage))result.coverage=result.coverage.map(row=>record(row)&&Array.isArray(row.factIds)?{...row,factIds:row.factIds.map(id=>typeof id==='string'?remap.get(id)??id:id)}:row);
 }
 return result;
}
/** Draft prose is still untrusted. Revalidate the COMPLETE repaired candidate;
 * never restore stale prose merely because a different field failed first.
 * Immutable evidence is supplied separately by the caller, not this object. */
export function mergeDiagnosedRepair(previous:unknown,candidate:unknown,repair:StageRepair){
 if(!scopePreserved(previous,candidate,repair.diagnostics??[]))throw new ProcessingError('REPAIR_UNDIAGNOSED_CHANGE');
 if(repair.stage!=='draft')throw new ProcessingError('REPAIR_SCOPE_UNRESOLVED');
 return clone(candidate);
}
