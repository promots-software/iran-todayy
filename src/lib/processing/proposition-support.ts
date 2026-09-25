import {z} from 'zod';
import {createHash} from 'node:crypto';
import {stableJson,structurallyEqual} from './structural-integrity';
export const structuralHash=(value:unknown)=>createHash('sha256').update(stableJson(value)).digest('hex');
import {ProcessingError} from './contracts';

export const PROPOSITION_VERSION='proposition-support-v4.4' as const;
export const PROPOSITION_CONFIG={model:'gemini-3.1-flash-lite',thinkingLevel:'high',maxOutputTokens:8192,candidateCount:1} as const;
const text=z.string().min(1).max(20000);
export const propositionEvidenceSchema=z.object({unitId:text,start:z.number().int().nonnegative(),end:z.number().int().positive(),excerpt:text}).strict();
export const propositionStateSchema=z.object({reference:z.enum(['PAST_CONTEXT','CURRENT','FUTURE','TIMELESS','UNSPECIFIED']),referenceText:z.string(),phase:z.enum(['PLANNED','OCCURRING','COMPLETED','UNSPECIFIED']),continuity:z.enum(['CONTINUING','BOUNDED','UNSPECIFIED']),certainty:z.enum(['ASSERTED','POSSIBLE','EXPECTED','CONDITIONAL','UNSPECIFIED']),polarity:z.enum(['POSITIVE','NEGATIVE','UNSPECIFIED'])}).strict();
export const propositionInventorySchema=z.object({propositions:z.array(z.object({id:text,evidence:propositionEvidenceSchema,actor:z.string(),action:text,objectContext:z.string(),speaker:z.string(),attribution:z.enum(['ATTRIBUTED','NARRATOR','UNSPECIFIED']),state:propositionStateSchema,relations:z.array(z.object({id:text,kind:z.enum(['PURPOSE','CAUSE','CONSEQUENCE','CONTEXT']),targetIds:z.array(text).min(1),evidence:propositionEvidenceSchema}).strict()),explanation:z.string()}).strict()).min(1).max(100),unresolved:z.array(text)}).strict();
export type PropositionEvidence=z.infer<typeof propositionEvidenceSchema>;
export type PropositionInventory=z.infer<typeof propositionInventorySchema>;
export type PropositionUnit={id:string;text:string};
export type PropositionSide={units:PropositionUnit[];inventory:PropositionInventory};
export type SourceSupport={kind:'SOURCE_PROPOSITION'|'SOURCE_RELATION';supportId:string};
type CatalogEntry=SourceSupport&{evidence:PropositionEvidence;propositionId?:string;relationId?:string;ownerId?:string;targetIds?:string[]};
export type SourceCatalog={source:PropositionSide;entries:CatalogEntry[];digest:string};
const fail=(reason:string):never=>{throw new ProcessingError('PROPOSITION_RECEIPT_INVALID',false,{stage:'proposition_review',issues:[{code:reason,path:[]}]});};
function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const p=schema.safeParse(raw);if(!p.success)return fail('SCHEMA');return p.data;}
function unique(ids:string[]){if(new Set(ids).size!==ids.length)fail('DUPLICATE_ID');}
function unitsMap(units:PropositionUnit[]){unique(units.map(u=>u.id));if(!units.length||units.some(u=>!u.id||!u.text))fail('INVALID_UNITS');return new Map(units.map(u=>[u.id,u.text]));}
/** Only analyzer metadata may be aligned to a UNIQUE verbatim occurrence.
 * Support IDs and receipt evidence are never corrected or normalized. */
export function validatePropositionEvidence(raw:unknown,units:PropositionUnit[],align=false){
 const e=parse(propositionEvidenceSchema,raw),s=unitsMap(units).get(e.unitId);if(s===undefined)fail('INVALID_UNIT');
 if(align){const start=s!.indexOf(e.excerpt);if(start<0||s!.indexOf(e.excerpt,start+1)>=0)fail('AMBIGUOUS_OR_MISSING_EVIDENCE');return {...e,start,end:start+e.excerpt.length};}
 if(e.end>s!.length||e.end<=e.start||s!.slice(e.start,e.end)!==e.excerpt)fail('INVALID_EVIDENCE');return e;
}
export function validatePropositionInventory(raw:unknown,units:PropositionUnit[],align=false){
 const x=parse(propositionInventorySchema,raw);unitsMap(units);unique(x.propositions.map(p=>p.id));unique(x.propositions.flatMap(p=>p.relations.map(r=>r.id)));
 for(const p of x.propositions){p.evidence=validatePropositionEvidence(p.evidence,units,align);for(const r of p.relations){unique(r.targetIds);if(r.targetIds.some(id=>!x.propositions.some(p=>p.id===id)))fail('INVALID_RELATION_ENDPOINT');r.evidence=validatePropositionEvidence(r.evidence,units,align);}}
 return x;
}
function entries(source:PropositionSide):CatalogEntry[]{
 validatePropositionInventory(source.inventory,source.units);
 return source.inventory.propositions.flatMap((p,i):CatalogEntry[]=>[{kind:'SOURCE_PROPOSITION',supportId:`source:proposition:${i}`,propositionId:p.id,evidence:p.evidence},...p.relations.map((r,j):CatalogEntry=>({kind:'SOURCE_RELATION',supportId:`source:relation:${i}:${j}`,relationId:r.id,ownerId:p.id,targetIds:r.targetIds,evidence:r.evidence}))]);
}
export function freezeSourceCatalog(source:PropositionSide):SourceCatalog{const cloned=structuredClone(source),catalog=entries(cloned);return {source:cloned,entries:catalog,digest:structuralHash({source:cloned,entries:catalog})};}
export function verifySourceCatalog(catalog:SourceCatalog,expectedDigest:string){
 if(catalog.digest!==expectedDigest||structuralHash({source:catalog.source,entries:catalog.entries})!==expectedDigest)fail('CATALOG_CHANGED');
 unique(catalog.entries.map(e=>e.supportId));if(!structurallyEqual(entries(catalog.source),catalog.entries))fail('INVALID_CATALOG');
}
const selection=z.object({kind:z.enum(['SOURCE_PROPOSITION','SOURCE_RELATION']),supportId:text}).strict();
export function supportWireSchema(catalog:SourceCatalog){
 const alternatives=(['SOURCE_PROPOSITION','SOURCE_RELATION'] as const).flatMap(kind=>{const ids=catalog.entries.filter(e=>e.kind===kind).map(e=>e.supportId);return ids.length?[z.object({kind:z.literal(kind),supportId:z.enum(ids)}).strict()]:[];});
 if(!alternatives.length)return fail('EMPTY_CATALOG');return alternatives.length===1?alternatives[0]:z.union(alternatives);
}
export function resolveSourceSupport(raw:unknown,catalog:SourceCatalog,expectedDigest:string){
 verifySourceCatalog(catalog,expectedDigest);const xs=parse(z.array(selection),raw);unique(xs.map(x=>x.supportId));
 return xs.map(x=>{const e=catalog.entries.find(e=>e.supportId===x.supportId);if(!e||e.kind!==x.kind)fail('INVALID_SUPPORT_ID_OR_KIND');return structuredClone(e!);});
}
export function propositionTargets(candidate:PropositionSide){return candidate.inventory.propositions.flatMap(p=>[{id:`candidate:p:${p.id}`,evidence:p.evidence,propositionId:p.id,relationId:null as string|null},...p.relations.map(r=>({id:`candidate:r:${p.id}:${r.id}`,evidence:r.evidence,propositionId:p.id,relationId:r.id}))]);}
const defectKind=z.enum(['TEMPORAL','ATTRIBUTION','PURPOSE','CAUSE','CONSEQUENCE','MODALITY','POLARITY','ENTITY','OTHER']);
const issueKind=z.enum(['TEMPORAL_CONTINUITY','PHASE','CERTAINTY','ATTRIBUTION','PURPOSE','CAUSE','CONSEQUENCE','ENTITY_RELATION','POLARITY','MISSING_SUPPORT','AMBIGUITY']);
const supports=z.array(selection);
export const supportAssessorSchema=z.object({assessments:z.array(z.object({targetId:text,candidateEvidence:propositionEvidenceSchema,state:z.enum(['SUPPORTED','UNSUPPORTED','UNRESOLVED']),sufficientGroups:z.array(supports.min(1)),defects:z.array(z.object({kind:defectKind,candidateEvidence:propositionEvidenceSchema,explanation:z.string()}).strict()),explanation:z.string()}).strict()).min(1)}).strict();
export const propositionComparatorSchema=z.object({judgments:z.array(z.object({candidateId:text,verdict:z.enum(['SUPPORTED','UNSUPPORTED','UNCERTAIN']),explanation:z.string(),sourceSupports:supports,issues:z.array(z.object({kind:issueKind,candidateRelationId:text.nullable(),candidateEvidence:propositionEvidenceSchema,sourceSupports:supports,explanation:z.string()}).strict())}).strict()).min(1),relationAssessments:z.array(z.object({candidateRelationId:text,verdict:z.enum(['SUPPORTED','UNSUPPORTED','UNCERTAIN']),sourceSupports:supports}).strict()),overall:z.enum(['SUPPORTED','UNSUPPORTED','UNCERTAIN'])}).strict();
export function propositionReviewSchemas(catalog:SourceCatalog){
 const ss=z.array(supportWireSchema(catalog));const a=supportAssessorSchema.shape.assessments.element,j=propositionComparatorSchema.shape.judgments.element;
 return {assessor:z.object({assessments:z.array(a.extend({sufficientGroups:z.array(ss.min(1))}))}).strict(),comparator:propositionComparatorSchema.extend({judgments:z.array(j.extend({sourceSupports:ss,issues:z.array(j.shape.issues.element.extend({sourceSupports:ss}))})),relationAssessments:z.array(propositionComparatorSchema.shape.relationAssessments.element.extend({sourceSupports:ss}))})};
}
function sameEvidence(a:PropositionEvidence,b:PropositionEvidence){return structurallyEqual(a,b);}
function overlaps(a:PropositionEvidence,b:PropositionEvidence){return a.unitId===b.unitId&&a.start<b.end&&a.end>b.start;}
export function validateSupportAssessor(raw:unknown,catalog:SourceCatalog,candidate:PropositionSide,expectedDigest:string){
 verifySourceCatalog(catalog,expectedDigest);validatePropositionInventory(candidate.inventory,candidate.units);
 const x=parse(supportAssessorSchema,raw),targets=propositionTargets(candidate);unique(x.assessments.map(a=>a.targetId));
 if(x.assessments.length!==targets.length)fail('TARGET_COVERAGE');
 for(const a of x.assessments){const t=targets.find(t=>t.id===a.targetId);if(!t||!sameEvidence(t.evidence,a.candidateEvidence))fail('TARGET_EVIDENCE');
  unique(a.sufficientGroups.map(g=>structuralHash(g.map(x=>x.supportId).sort())));
  a.sufficientGroups.forEach(g=>resolveSourceSupport(g,catalog,expectedDigest));
  if(a.state==='SUPPORTED'?(!a.sufficientGroups.length||a.defects.length):a.sufficientGroups.length)fail('INCONSISTENT_SUPPORT');
  if(a.state==='UNSUPPORTED'&&!a.defects.length)fail('MISSING_DEFECT');
  for(const d of a.defects){validatePropositionEvidence(d.candidateEvidence,candidate.units);if(!overlaps(d.candidateEvidence,t!.evidence))fail('UNRELATED_DEFECT');}
 }
 return x;
}
export function validatePropositionComparator(raw:unknown,catalog:SourceCatalog,candidate:PropositionSide,expectedDigest:string){
 verifySourceCatalog(catalog,expectedDigest);validatePropositionInventory(candidate.inventory,candidate.units);
 const x=parse(propositionComparatorSchema,raw),ps=candidate.inventory.propositions,relations=ps.flatMap(p=>p.relations.map(r=>({...r,owner:p.id})));
 unique(x.judgments.map(j=>j.candidateId));unique(x.relationAssessments.map(r=>r.candidateRelationId));
 if(x.judgments.length!==ps.length||x.relationAssessments.length!==relations.length)fail('INCOMPLETE_ACCOUNTING');
 for(const j of x.judgments){const p=ps.find(p=>p.id===j.candidateId);if(!p)fail('UNKNOWN_CANDIDATE');resolveSourceSupport(j.sourceSupports,catalog,expectedDigest);
  if(j.verdict==='SUPPORTED'&&(!j.sourceSupports.length||j.issues.length)||j.verdict==='UNSUPPORTED'&&!j.issues.length)fail('INCONSISTENT_JUDGMENT');
  for(const i of j.issues){validatePropositionEvidence(i.candidateEvidence,candidate.units);resolveSourceSupport(i.sourceSupports,catalog,expectedDigest);
   const r=i.candidateRelationId===null?null:relations.find(r=>r.id===i.candidateRelationId);if(i.candidateRelationId!==null&&(!r||r.owner!==p!.id&&!r.targetIds.includes(p!.id)))fail('INVALID_RELATION_BINDING');
   if(!overlaps(i.candidateEvidence,r?.evidence??p!.evidence))fail('UNRELATED_ISSUE');
  }
 }
 for(const a of x.relationAssessments){if(!relations.some(r=>r.id===a.candidateRelationId))fail('UNKNOWN_RELATION');resolveSourceSupport(a.sourceSupports,catalog,expectedDigest);if(a.verdict==='SUPPORTED'&&!a.sourceSupports.length)fail('MISSING_RELATION_SUPPORT');}
 const verdicts=[...x.judgments,...x.relationAssessments].map(j=>j.verdict);const expected=verdicts.includes('UNSUPPORTED')?'UNSUPPORTED':verdicts.includes('UNCERTAIN')?'UNCERTAIN':'SUPPORTED';if(x.overall!==expected)fail('INCONSISTENT_OVERALL');return x;
}
/** Allowlisted projection: prose never defines source state, scope or authority. */
export function propositionAuthority(assessor:ReturnType<typeof validateSupportAssessor>,comparator:ReturnType<typeof validatePropositionComparator>){return {
 assessments:assessor.assessments.map(a=>({targetId:a.targetId,candidateEvidence:a.candidateEvidence,state:a.state,sufficientGroups:a.sufficientGroups,defects:a.defects.map(d=>({kind:d.kind,candidateEvidence:d.candidateEvidence}))})),
 judgments:comparator.judgments.map(j=>({candidateId:j.candidateId,verdict:j.verdict,sourceSupports:j.sourceSupports,issues:j.issues.map(i=>({kind:i.kind,candidateRelationId:i.candidateRelationId,candidateEvidence:i.candidateEvidence,sourceSupports:i.sourceSupports}))})),
 relationAssessments:comparator.relationAssessments,overall:comparator.overall,
};}
/** OR of complete AND groups; unrelated extras and partial extra groups fail. */
export function reconcileSupportGroups(groups:SourceSupport[][],selected:SourceSupport[]){
 const ids=new Set(selected.map(s=>s.supportId)),complete=groups.filter(g=>g.every(s=>ids.has(s.supportId)));
 return complete.length>0&&[...ids].every(id=>complete.some(g=>g.some(s=>s.supportId===id)));
}
export function reconcilePropositions(assessorRaw:unknown,comparatorRaw:unknown,catalog:SourceCatalog,candidate:PropositionSide,expectedDigest:string){
 const assessor=validateSupportAssessor(assessorRaw,catalog,candidate,expectedDigest),comparator=validatePropositionComparator(comparatorRaw,catalog,candidate,expectedDigest),authority=propositionAuthority(assessor,comparator);
 if(catalog.source.inventory.unresolved.length||candidate.inventory.unresolved.length)return {verdict:'UNCERTAIN' as const,authority};
 for(const t of propositionTargets(candidate)){
  const a=authority.assessments.find(a=>a.targetId===t.id)!;
  const c=t.relationId===null?authority.judgments.find(j=>j.candidateId===t.propositionId)!:authority.relationAssessments.find(r=>r.candidateRelationId===t.relationId)!;
  if(a.state==='UNRESOLVED'||c.verdict==='UNCERTAIN')return {verdict:'UNCERTAIN' as const,authority};
  if(a.state!==c.verdict)return {verdict:'UNCERTAIN' as const,authority};
  if(a.state==='SUPPORTED'&&!reconcileSupportGroups(a.sufficientGroups,c.sourceSupports))return {verdict:'UNCERTAIN' as const,authority};
 }
 return {verdict:comparator.overall,authority};
}
export function propositionRequestIdentity(source:PropositionSide,candidate:PropositionSide,catalog:SourceCatalog){verifySourceCatalog(catalog,catalog.digest);return structuralHash({version:PROPOSITION_VERSION,config:PROPOSITION_CONFIG,source,candidate,catalogDigest:catalog.digest});}
