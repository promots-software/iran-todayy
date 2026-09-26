import {ProcessingError} from './contracts';
type Schema={properties:{matches:{properties:Record<string,unknown>}}};
/** Wire-only projection; original matcher schema and decisions remain authoritative. */
export function matchingWireSchema(schema:unknown){
 const entries=Object.entries((schema as Schema).properties.matches.properties);
 if(!entries.length)throw new ProcessingError('INVALID_COMPARISON_SCHEMA');
 const row=entries[0][1] as {properties:Record<string,unknown>;required:string[]};
 return {type:'object',properties:{matches:{type:'array',items:{type:'object',properties:{candidateId:{type:'string'},...row.properties},required:['candidateId',...row.required],additionalProperties:false}}},required:['matches'],additionalProperties:false};
}
export function matchingSerialization(schema:unknown){
 const count=Object.keys((schema as Schema).properties.matches.properties).length;
 return `Response serialization only: return matches as rows. Each row must carry candidateId equal to the supplied candidate id and the existing relation, materialUpdate, conflict and rationale fields. Return exactly ${count} rows: one for EVERY candidate, including DIFFERENT_OCCURRENCE results. Do not stop after finding a match. No missing, duplicate or extra candidate IDs.`;
}
export function decodeMatchingReceipt(content:string,schema:unknown):string{
 const fail=():never=>{throw new ProcessingError('INVALID_COMPARISON_SCHEMA');};
 let raw:unknown;try{raw=JSON.parse(content);}catch{return fail();}
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==1||!('matches'in raw)||!Array.isArray(raw.matches))return fail();
 const ids=new Set(Object.keys((schema as Schema).properties.matches.properties));
 const matches:Record<string,unknown>=Object.create(null);
 for(const value of raw.matches){
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();
  const {candidateId,...decision}=value;
  if(typeof candidateId!=='string'||!ids.has(candidateId)||Object.hasOwn(matches,candidateId))return fail();
  matches[candidateId]=decision;
 }
 if(Object.keys(matches).length!==ids.size)return fail();
 return JSON.stringify({matches});
}
