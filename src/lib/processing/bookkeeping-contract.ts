import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ProcessingError} from './contracts';
import {sourceUnits} from './source-units';
import {stableJson} from './structural-integrity';
import {temporalComparisonSchema,materialComponentSchema,fidelityLedgerSchema} from './fidelity-ledger-contract';
import {renderingReviewSchema} from './rendering-contract';

type Atom={id:string;start:number;end:number;text:string};
type Selection={first:string;last:string};
/** No normalized copies: all coordinates are slices of this frozen representation.
 * Endpoints select a contiguous span, never concatenate distant evidence. Hashes
 * bind IDs to both the text and namespace (source versus publication unit). */
export function spanCatalog(text:string,namespace:string){
 const digest=createHash('sha256').update(stableJson([namespace,text])).digest('hex');
 const atoms:readonly Readonly<Atom>[]=Object.freeze([...text.matchAll(/[\p{L}\p{M}\p{N}_\u200c\u200d]+|[^\s]/gu)].map((m,i)=>Object.freeze({id:`${namespace}:${digest.slice(0,16)}:${i}`,start:m.index!,end:m.index!+m[0].length,text:m[0]})));
 // Catalog membership is checked locally without duplicating large wire enums.
 const id=z.string().min(1).max(100);
 const selection=z.object({first:id,last:id}).strict();
 return {digest,atoms,selection,resolve(raw:Selection){
  const value=selection.parse(raw),first=atoms.find(a=>a.id===value.first),last=atoms.find(a=>a.id===value.last);
  if(!first||!last)throw new ProcessingError('UNKNOWN_EVIDENCE_SELECTION');
  if(first.start>last.start)throw new ProcessingError('EVIDENCE_SELECTION_ORDER_INVALID');
  return {excerpt:text.slice(first.start,last.end),startOffset:first.start,endOffset:last.end};
 }};
}
const unique=<T>(values:T[])=>new Set(values).size===values.length;
const fail=(code:string):never=>{throw new ProcessingError(code);};
const obj=(schema:unknown)=>schema as z.ZodObject<z.ZodRawShape>;
const enumeration=(ids:string[])=>ids.length?z.enum(ids):z.never();
function keyed(ids:string[],make:(id:string)=>z.ZodType){return z.object(Object.fromEntries(ids.map(id=>[id,make(id)]))).strict();}
export type BookkeepingContract={schema:z.ZodType;input:unknown;instructions:string;decode:(raw:unknown)=>unknown};

/** The canonical local contracts stay unchanged. This adapter removes provider
 * arithmetic/echo requirements only; all original validators run after decode. */
export function bookkeepingContract(step:string|undefined,input:unknown,canonical:z.ZodType):BookkeepingContract|null{
 if(!['extract','direct_combined','direct_independent_review','direct_publication_review'].includes(step??''))return null;
 const data=input as Record<string,unknown>,source=String(data.content??data.originalSource??'');
 const units=sourceUnits(source),unitIds=units.map(u=>u.id),sourceCatalog=spanCatalog(source,'source');
 if(!sourceCatalog.atoms.length)return null;
 const context=z.object({firstUnit:enumeration(unitIds),lastUnit:enumeration(unitIds)}).strict();
 const evidence=z.object({span:sourceCatalog.selection,context}).strict();
 function dereferenceEvidence(raw:unknown){
  const selected=evidence.parse(raw),span=sourceCatalog.resolve(selected.span);
  const first=units.find(u=>u.id===selected.context.firstUnit)!,last=units.find(u=>u.id===selected.context.lastUnit)!;
  if(first.start>last.start||span.startOffset<first.start||span.endOffset>last.end)fail('EVIDENCE_CONTEXT_SELECTION_INVALID');
  return {...span,context:source.slice(first.start,last.end)};
 }
 const catalogId=createHash('sha256').update(stableJson(['bookkeeping-v1',step,source,data.publication??null])).digest('hex');
 const catalogs={catalogId,sourceAtoms:sourceCatalog.atoms.map(({id,text})=>({id,text})),sourceUnits:units};
 const wireInstructions='MECHANICAL REPRESENTATION CONTRACT (replaces only legacy ID/offset/excerpt formatting instructions): use the supplied catalogId. Evidence is selected by first/last immutable atom IDs: one contiguous span, not a splice. Context selects first/last source units. Never emit excerpts, offsets or invented IDs. Atoms retain exact source spelling, hashtags, Persian characters and joiners. Selection is semantic: an existing but unrelated span is NOT support. Source and candidate namespaces are separate. Application dereferences coordinates; it does not infer missing semantic associations. All factual, temporal, attribution, coverage and editorial requirements remain mandatory.';
 if(step==='extract'||step==='direct_combined'){
  const base=step==='extract'?obj(canonical):obj(obj(canonical).shape.extraction);
  const statement=(base.shape.statements as z.ZodArray<z.ZodType>).element;
  const bindStatement=(value:unknown)=>obj(value).extend({evidence,speaker:obj(value).shape.speaker instanceof z.ZodNull?z.null():step==='extract'?evidence.nullable():evidence,sourceUnitIds:z.array(enumeration(unitIds)).min(1).max(unitIds.length)}).strict();
  const boundStatement=statement instanceof z.ZodUnion?z.union(statement.options.map(bindStatement)):bindStatement(statement);
  const extraction=base.omit({coverage:true}).extend({
   actors:z.array(evidence).max(30),action:evidence.nullable(),object:evidence.nullable(),location:evidence.nullable(),event_time:evidence.nullable(),contentTypeEvidence:evidence,
   statements:z.array(boundStatement).max(100),
   nonFactualUnitIds:z.array(enumeration(unitIds)).max(unitIds.length),
  }).strict();
  const schema=(step==='extract'?extraction:obj(canonical).extend({extraction})).extend({catalogId:z.literal(catalogId)}).strict();
  return {schema,input:{...data,bookkeeping:catalogs},instructions:wireInstructions+' Each statement selects ALL sourceUnitIds whose meaning it covers (including repeated headings and governing speaker units). Do not generate f1/f2 or coverage rows. Application assigns fact IDs by statement order and inverts these explicit associations. nonFactualUnitIds may contain only truly non-factual units; no factual omissions or uncertainty may be hidden there.',decode(raw){
   const parsed=schema.parse(raw) as Record<string,unknown>;const x=(step==='extract'?parsed:parsed.extraction) as Record<string,unknown>;
   const nonFactual=x.nonFactualUnitIds as string[];
   if(!unique(nonFactual))fail('DUPLICATE_COVERAGE_SELECTION');
   const statements=(x.statements as Record<string,unknown>[]).map((s,i)=>{
    const selected=s.sourceUnitIds as string[];if(!unique(selected)||selected.some(id=>nonFactual.includes(id)))fail('CONFLICTING_COVERAGE_SELECTION');
    return {id:`f${i+1}`,selected,value:{...Object.fromEntries(Object.entries(s).filter(([k])=>k!=='sourceUnitIds')),evidence:dereferenceEvidence(s.evidence),speaker:s.speaker?dereferenceEvidence(s.speaker):null}};
   });
   const coverage=units.map(u=>{const factIds=statements.filter(s=>s.selected.includes(u.id)).map(s=>s.id);if(!factIds.length&&!nonFactual.includes(u.id))fail('INCOMPLETE_COVERAGE_SELECTION');return {unitId:u.id,factIds,nonFactual:nonFactual.includes(u.id)};});
   const resolved:Record<string,unknown>={...Object.fromEntries(Object.entries(x).filter(([k])=>!['nonFactualUnitIds','catalogId'].includes(k))),coverage,statements:statements.map(s=>s.value),actors:(x.actors as unknown[]).map(dereferenceEvidence),contentTypeEvidence:dereferenceEvidence(x.contentTypeEvidence)};
   // Legacy content-type evidence has no offset fields; its exact context remains.
   const c=resolved.contentTypeEvidence as ReturnType<typeof dereferenceEvidence>;resolved.contentTypeEvidence={excerpt:c.excerpt,context:c.context};
   for(const k of ['action','object','location','event_time'])resolved[k]=x[k]?dereferenceEvidence(x[k]):null;
   return step==='extract'?resolved:{extraction:resolved,...(obj(canonical).shape.article?{article:parsed.article}:{})};
  }};
 }
 const publication=data.publication as {id:string;text:string}[];
 if(!Array.isArray(publication)||!publication.length||!unique(publication.map(p=>p.id)))fail('INVALID_PUBLICATION_INVENTORY');
 const publicationIds=publication.map(p=>p.id),candidateCatalogs=new Map(publication.map(p=>[p.id,spanCatalog(p.text,`candidate:${p.id}`)]));
 const temporalFor=(id:string)=>temporalComparisonSchema.omit({publicationId:true,sourceExcerpt:true,candidateExcerpt:true}).extend({sourceSpan:sourceCatalog.selection,candidateSpan:candidateCatalogs.get(id)!.selection}).strict();
 const sourceCoverage=keyed(unitIds,()=>z.object({disposition:fidelityLedgerSchema.shape.sourceCoverage.element.shape.disposition,explanation:z.string().min(1).max(20000),comparisons:keyed(publicationIds,id=>z.array(temporalFor(id)).max(30))}).strict());
 const claims=keyed(publicationIds,id=>z.object({components:z.array(materialComponentSchema.omit({id:true,excerpt:true}).extend({span:candidateCatalogs.get(id)!.selection,sourceUnitIds:z.array(enumeration(unitIds)).min(1).max(unitIds.length)}).strict()).min(1).max(100),explanation:z.string().min(1).max(20000)}).strict());
 const review=keyed(publicationIds,()=>renderingReviewSchema.omit({id:true}));
 const schema=obj(canonical).extend({catalogId:z.literal(catalogId),review,fidelityLedger:z.object({sourceCoverage,claims}).strict()}).strict();
 return {schema,input:{...data,bookkeeping:{...catalogs,candidateAtoms:Object.fromEntries(publication.map(p=>[p.id,candidateCatalogs.get(p.id)!.atoms.map(({id,text})=>({id,text}))]))}},instructions:wireInstructions+' Review is keyed by the supplied publication ID, never an array. Source coverage is keyed by sourceUnitId. comparisons is keyed by publicationId: [] only when that unit is not supported by that publication; PRESERVED units require semantic comparisons (use TIMELESS/UNSPECIFIED when appropriate, never invent event time). Select exact source/candidate spans; no prose evidence or ellipses. Claims are keyed by publicationId and cover the entire unchanged publication unit. Select independently assessable component spans accounting for ALL wording; they may overlap for context. Application derives component IDs, parent verdict from components, source-link unions and publication IDs. Missing component coverage still fails. Rationale is audit-only; semantic assessments and component verdicts must diagnose every unsupported change. Do not label missing material as presentation.',decode(raw){
  const parsed=schema.parse(raw) as Record<string,unknown>;
  type Component={span:Selection;sourceUnitIds:string[];verdict:'SUPPORTED'|'UNSUPPORTED'|'UNCERTAIN';explanation:string};
  const ledger=parsed.fidelityLedger as {claims:Record<string,{components:Component[];explanation:string}>;sourceCoverage:Record<string,{disposition:string;explanation:string;comparisons:Record<string,Record<string,unknown>[]>}>};
  const resolvedClaims=publication.map((p,i)=>{
   const claim=ledger.claims[p.id];const components=claim.components.map((c,j)=>{if(!unique(c.sourceUnitIds))fail('DUPLICATE_COMPONENT_SOURCE_LINK');return {id:`c${i+1}.${j+1}`,excerpt:candidateCatalogs.get(p.id)!.resolve(c.span).excerpt,sourceUnitIds:c.sourceUnitIds,verdict:c.verdict,explanation:c.explanation};});
   return {publicationId:p.id,excerpt:p.text,components,sourceUnitIds:[...new Set(components.flatMap(c=>c.sourceUnitIds))],verdict:components.some(c=>c.verdict==='UNSUPPORTED')?'UNSUPPORTED':components.some(c=>c.verdict==='UNCERTAIN')?'UNCERTAIN':'SUPPORTED',explanation:claim.explanation};
  });
  const resolvedCoverage=units.map(u=>{
   const row=ledger.sourceCoverage[u.id];const temporal=publication.flatMap(p=>row.comparisons[p.id].map(t=>{
    const span=sourceCatalog.resolve(t.sourceSpan as Selection);if(span.startOffset<u.start||span.endOffset>u.end)fail('TEMPORAL_SOURCE_UNIT_MISMATCH');
    const {sourceSpan:ignored,candidateSpan:ignored2,...rest}=t;void ignored;void ignored2;
    return {...rest,publicationId:p.id,sourceExcerpt:span.excerpt,candidateExcerpt:candidateCatalogs.get(p.id)!.resolve(t.candidateSpan as Selection).excerpt};
   }));
   return {unitId:u.id,disposition:row.disposition,explanation:row.explanation,publicationIds:publicationIds.filter(id=>row.comparisons[id].length||resolvedClaims.some(c=>c.publicationId===id&&c.sourceUnitIds.includes(u.id))),temporal};
  });
  const {catalogId:ignored,...rest}=parsed;void ignored;
  return {...rest,review:publicationIds.map(id=>({id,...(parsed.review as Record<string,object>)[id]})),fidelityLedger:{sourceCoverage:resolvedCoverage,claims:resolvedClaims}};
 }};
}
