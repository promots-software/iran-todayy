import {createHash} from 'node:crypto';
import type {RepairDiagnostic,RepairPath} from './repair-contract';
export * from './repair-contract';
import {stableJson} from './structural-integrity';
export const MAX_TARGETED_REPAIRS=2 as const;
export const candidateHash=(v:unknown)=>v===undefined?null:createHash('sha256').update(stableJson(v)).digest('hex');
export function atPath(v:unknown,path:RepairPath):unknown{for(const part of path){if(!v||typeof v!=='object')return undefined;v=(v as Record<string,unknown>)[part];}return v;}
export function changedPaths(before:unknown,after:unknown,path:RepairPath=[]):RepairPath[]{
 if(stableJson(before)===stableJson(after))return [];
 if(!before||!after||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)!==Array.isArray(after))return [path];
 // Changed cardinality cannot be excused by an index-based partial merge.
 if(Array.isArray(before)&&Array.isArray(after)&&before.length!==after.length)return [path];
 return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(k=>changedPaths((before as Record<string,unknown>)[k],(after as Record<string,unknown>)[k],[...path,Array.isArray(before)?Number(k):k]));
}
export function scopePreserved(before:unknown,after:unknown,diagnostics:RepairDiagnostic[]){
 const allowed=diagnostics.flatMap(d=>d.allowedPaths);
 return changedPaths(before,after).every(path=>allowed.some(scope=>scope.length>0&&scope.length<=path.length&&scope.every((p,i)=>p===path[i])))&&diagnostics.every(d=>{
  if(!d.immutableText?.length)return true;
  const text=atPath(after,d.path);if(typeof text!=='string')return false;
  let cursor=0;for(const region of d.immutableText){const at=text.indexOf(region,cursor);if(at<0)return false;cursor=at+region.length;}return true;
 });
}
const blocked=/AMBIGUOUS|UNCERTAIN|RECEIPT|SERIALIZATION|STRUCTURAL_EQUALITY|SOURCE_LANGUAGE|SCHEMA_CONTRADICTION|UNRELATED|PROMO|DUPLICATE|SOURCE_TEXT_REQUIRED|NORMALIZATION/u;
const actionable=new Set(['NON_ARABIC_OUTPUT','DIRECT_PUBLICATION_NUMBER_MISMATCH','DIRECT_PUBLICATION_DATE_MISMATCH','DIRECT_PUBLICATION_QUOTE_MISMATCH','DIRECT_PUBLICATION_ENTITY_ATTRIBUTION_MISMATCH','UNSUPPORTED_ASSERTION','UNSUPPORTED_CAUSALITY','MODALITY_MISMATCH','CERTAINTY_MISMATCH','MISSING_SUPPORTED_FACT','CANONICAL_STRUCTURE_DEFECT']);
export function secondRepairDecision(current:RepairDiagnostic[],previous:RepairDiagnostic[],source:string,candidate:unknown){
 if(!current.length)return 'NO_PRECISE_DIAGNOSIS';
 for(const d of current){
  if(blocked.test(d.code)||!actionable.has(d.code))return 'NOT_SAFELY_AI_REPAIRABLE';
  if(!d.expected||!d.cause||!d.path.length||!d.allowedPaths.length||!d.factIds.length||!d.sourceSpans.length)return 'INCOMPLETE_GROUNDED_DIAGNOSIS';
  if(stableJson(atPath(candidate,d.path))!==stableJson(d.current))return 'STALE_DIAGNOSIS';
  if(d.sourceSpans.some(e=>!Number.isInteger(e.start)||!Number.isInteger(e.end)||e.start<0||e.end<=e.start||source.slice(e.start,e.end)!==e.text))return 'INVALID_DIAGNOSTIC_EVIDENCE';
 }
 if(current.every(d=>previous.some(p=>stableJson(p)===stableJson(d))))return 'IDENTICAL_DIAGNOSIS_NO_NEW_INFORMATION';
 return 'TARGETED_SECOND_REPAIR';
}
/** Only generated text; preserve every delimited literal exactly. Evidence is
 * never passed through this function. Normalization is not semantic acceptance. */
export function normalizeGeneratedArabic(text:string){
 return text.split(/(«[^»]*»|“[^”]*”|"[^"\n]*")/gu).map((part,i)=>i%2?part:part.replace(/ی/gu,'ي').replace(/ک/gu,'ك')).join('');
}
