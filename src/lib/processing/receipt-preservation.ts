import {createHash} from 'node:crypto';
import {ProcessingError} from './contracts';
import {materialComponentSchema,temporalComparisonSchema} from './fidelity-ledger-contract';
import {sourceUnits} from './source-units';

type Publication={id:string;text:string};
export type ReviewContext={originalSource:string;publication:Publication[]};
type Span={publicationId:string;start:number;end:number;sourceUnitIds:string[]};
type Negative=Span&{verdict:'UNSUPPORTED'|'UNCERTAIN'};
type Temporal=Span&{unitId:string;row:ReturnType<typeof temporalComparisonSchema.parse>};
export type ReceiptProtection={identity:string;negative:Negative[];temporal:Temporal[]};
const rank={SUPPORTED:0,UNCERTAIN:1,UNSUPPORTED:2};
const object=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const array=(x:unknown):unknown[]=>Array.isArray(x)?x:[];
const ledger=(x:unknown)=>object(object(x).fidelityLedger??x);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const identity=(c:ReviewContext)=>createHash('sha256').update(JSON.stringify({originalSource:c.originalSource,publication:c.publication.map(p=>({id:p.id,text:p.text}))})).digest('hex');
function range(text:string,excerpt:unknown){
 if(typeof excerpt!=='string'||!excerpt.length)return null;
 const start=text.indexOf(excerpt);if(start<0||text.indexOf(excerpt,start+1)>=0)return null;
 return {start,end:start+excerpt.length};
}
function links(raw:unknown,valid:Set<string>){
 if(!Array.isArray(raw)||!raw.length||raw.some(id=>typeof id!=='string'||!valid.has(id))||new Set(raw).size!==raw.length)return null;
 return [...raw].sort() as string[];
}
function components(raw:unknown,c:ReviewContext){
 const valid=new Set(sourceUnits(c.originalSource).map(u=>u.id));
 return array(ledger(raw).claims).flatMap(rawClaim=>{
  const claim=object(rawClaim),p=c.publication.find(p=>p.id===claim.publicationId);if(!p)return [];
  const parent=range(p.text,claim.excerpt),parentLinks=links(claim.sourceUnitIds,valid);if(!parent||!parentLinks)return [];
  return array(claim.components).flatMap(rawPart=>{
   const parsed=materialComponentSchema.safeParse(rawPart);if(!parsed.success)return [];
   const part=parsed.data,span=range(p.text,part.excerpt),ids=links(part.sourceUnitIds,valid);
   if(!span||!ids||ids.some(id=>!parentLinks.includes(id))||span.start<parent.start||span.end>parent.end)return [];
   return [{...span,publicationId:p.id,sourceUnitIds:ids,verdict:part.verdict}];
  });
 });
}
function temporal(raw:unknown,c:ReviewContext):Temporal[]{
 const units=sourceUnits(c.originalSource);
 return array(ledger(raw).sourceCoverage).flatMap(rawRow=>{
  const row=object(rawRow),unit=units.find(u=>u.id===row.unitId);if(!unit)return [];
  return array(row.temporal).flatMap(rawTime=>{
   const parsed=temporalComparisonSchema.safeParse(rawTime);if(!parsed.success)return [];
   const t=parsed.data,p=c.publication.find(p=>p.id===t.publicationId),span=p&&range(p.text,t.candidateExcerpt);
   if(!span||!range(unit.text,t.sourceExcerpt)||!array(row.publicationIds).includes(t.publicationId))return [];
   return [{...span,publicationId:t.publicationId,sourceUnitIds:[unit.id],unitId:unit.id,row:t}];
  });
 });
}
/** Salvage only individually identifiable findings, not an invalid receipt's
 * semantic certification. Repeated/ambiguous excerpts never acquire authority. */
export function protectReceipt(raw:unknown,c:ReviewContext):ReceiptProtection{
 const parts=components(raw,c),negative=parts.filter((p):p is Negative=>p.verdict!=='SUPPORTED');
 const times=temporal(raw,c).filter(t=>t.row.assessment==='UNCERTAIN'||t.row.assessment==='CHANGED'&&!same(t.row.sourceState,t.row.candidateState)&&negative.some(n=>n.verdict==='UNSUPPORTED'&&n.publicationId===t.publicationId&&n.sourceUnitIds.includes(t.unitId)&&n.start<t.end&&n.end>t.start));
 return {identity:identity(c),negative,temporal:times};
}
const overlap=(a:Span,b:Span)=>a.publicationId===b.publicationId&&a.start<b.end&&a.end>b.start;
function fail(code:string):never{throw new ProcessingError('REVIEW_RECEIPT_INVALID',false,{stage:'publication_review',issues:[{code,path:['receiptCorrection']}]});}
/** Local-only authority: never accepted from model JSON or a serialized receipt.
 * Provider checkpoint replay rebuilds this from the initial and corrected raw
 * responses; article repair persists the resulting immutableText diagnostics. */
const authorities=new WeakMap<object,{identity:string;cores:Span[]}>();
export function preserveReceipt(initial:ReceiptProtection,corrected:unknown,c:ReviewContext,validated:unknown){
 if(initial.identity!==identity(c))fail('RECEIPT_CONTEXT_CHANGED');
 const parts=components(corrected,c);
 for(const n of initial.negative){
  const matches=parts.filter(p=>overlap(n,p));
  if(matches.some(p=>rank[p.verdict]<rank[n.verdict]||!same(p.sourceUnitIds,n.sourceUnitIds)))fail('PROTECTED_FINDING_RELAXED');
  const covered=new Uint8Array(n.end-n.start);
  for(const p of matches)covered.fill(1,Math.max(n.start,p.start)-n.start,Math.min(n.end,p.end)-n.start);
  if(covered.some(v=>!v))fail('PROTECTED_FINDING_REMOVED');
 }
 const times=temporal(corrected,c);
 for(const t of initial.temporal){
  if(!times.some(x=>x.publicationId===t.publicationId&&x.unitId===t.unitId&&x.start===t.start&&x.end===t.end&&x.row.sourceExcerpt===t.row.sourceExcerpt&&same(x.row.sourceState,t.row.sourceState)&&same(x.row.candidateState,t.row.candidateState)&&(t.row.assessment==='CHANGED'?x.row.assessment==='CHANGED':x.row.assessment!=='PRESERVED')))fail('PROTECTED_TEMPORAL_RELAXED');
 }
 const cores:Span[]=[];
 // Expanded bookkeeping never expands the authority of an existing negative.
 const add=(p:Span)=>{const prior=initial.negative.filter(n=>n.publicationId===p.publicationId);if(prior.length){for(const n of prior.filter(n=>overlap(n,p)))cores.push({...p,start:Math.max(n.start,p.start),end:Math.min(n.end,p.end)});}else cores.push(p);};
 parts.filter(p=>p.verdict==='UNSUPPORTED').forEach(add);
 times.filter(t=>t.row.assessment==='CHANGED').forEach(add);
 authorities.set(ledger(validated),{identity:initial.identity,cores});
}
export function copyReceiptAuthority(from:unknown,to:unknown){const a=authorities.get(ledger(from));if(a)authorities.set(ledger(to),a);}
export function receiptRepairCores(raw:unknown,c:ReviewContext):Span[]|undefined{
 const a=authorities.get(ledger(raw));if(!a)return undefined;
 if(a.identity!==identity(c))fail('RECEIPT_REPAIR_CONTEXT_CHANGED');return a.cores.map(s=>({...s,sourceUnitIds:[...s.sourceUnitIds]}));
}
