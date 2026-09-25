import {z} from 'zod';
import {ProcessingError,type Understanding} from './contracts';
import {propositionAnalysisInstructions,supportAssessorInstructions,independentComparatorInstructions} from './proposition-instructions';
import {PROPOSITION_VERSION,PROPOSITION_CONFIG,propositionInventorySchema,validatePropositionInventory,freezeSourceCatalog,propositionReviewSchemas,propositionTargets,validateSupportAssessor,validatePropositionComparator,reconcilePropositions,propositionRequestIdentity,structuralHash,type PropositionUnit} from './proposition-support';
import {groundedRepairDiagnostic} from './repair-diagnostics';
import {atPath,type RepairDiagnostic,type RepairPath} from './targeted-repair';

export type PropositionStage='proposition_source'|'proposition_candidate'|'proposition_assessor'|'proposition_comparator';
export type PropositionRequest={stage:PropositionStage;schema:z.ZodType;instructions:string;input:unknown};
export type PropositionTransport=(request:PropositionRequest)=>Promise<unknown>;
/** This orchestrator has no transport/credentials or provider retry loop.
 * Every request uses the existing durable guarded transport, with its full
 * instructions/schema/config/input as checkpoint identity. */
export async function reviewPropositions(sourceText:string,publication:PropositionUnit[],request:PropositionTransport){
 const analyze=async(stage:'proposition_source'|'proposition_candidate',units:PropositionUnit[])=>({units,inventory:validatePropositionInventory(await request({stage,schema:propositionInventorySchema,instructions:propositionAnalysisInstructions,input:{version:PROPOSITION_VERSION,role:stage,units}}),units,true)});
 // Source-only input is candidate-independent and reusable across article repairs.
 const source=await analyze('proposition_source',[{id:'source',text:sourceText}]);
 const candidate=await analyze('proposition_candidate',publication.map(p=>({id:p.id,text:p.text})));
 const catalog=freezeSourceCatalog(source),digest=catalog.digest,identity=propositionRequestIdentity(source,candidate,catalog),schemas=propositionReviewSchemas(catalog);
 const machineSide=(side:typeof source)=>({units:side.units,inventory:{unresolved:side.inventory.unresolved.map(()=>true),propositions:side.inventory.propositions.map(p=>({id:p.id,evidence:p.evidence,actor:p.actor,action:p.action,objectContext:p.objectContext,speaker:p.speaker,attribution:p.attribution,state:{reference:p.state.reference,phase:p.state.phase,continuity:p.state.continuity,certainty:p.state.certainty,polarity:p.state.polarity},relations:p.relations}))}});
 const input={version:PROPOSITION_VERSION,identity,catalogDigest:digest,source:machineSide(source),candidate:machineSide(candidate),sourceSupportCatalog:catalog.entries};
 const assessor=validateSupportAssessor(await request({stage:'proposition_assessor',schema:schemas.assessor,instructions:supportAssessorInstructions,input:{...input,targetManifest:propositionTargets(candidate).map(t=>({id:t.id,evidence:t.evidence}))}}),catalog,candidate,digest);
 // Frozen assessor is NEVER included in the independent comparator request.
 const comparator=validatePropositionComparator(await request({stage:'proposition_comparator',schema:schemas.comparator,instructions:independentComparatorInstructions,input}),catalog,candidate,digest);
 const result=reconcilePropositions(assessor,comparator,catalog,candidate,digest);
 return {version:PROPOSITION_VERSION,config:PROPOSITION_CONFIG,identity,source,candidate,catalogDigest:digest,assessor,comparator,...result};
}
export type PropositionReview=Awaited<ReturnType<typeof reviewPropositions>>;
/** Raw reviewer prose remains in durable response checkpoints for audit. This
 * projection alone may control bounded article repair. Unlinked scope holds. */
export function propositionRepairDiagnostics(review:PropositionReview,source:string,u:Understanding,candidate:unknown,direct:boolean):RepairDiagnostic[]{
 if(review.verdict!=='UNSUPPORTED')return [];
 const ds:RepairDiagnostic[]=[];
 for(const a of review.authority.assessments.filter(a=>a.state==='UNSUPPORTED')){
  for(const defect of a.defects){
   const e=defect.candidateEvidence,id=e.unitId;
   const path:RepairPath=direct?['article',id==='title'?'title':'body']:id==='title'?['publication','title','text']:['publication','body',Number(id.split(':')[1])-1,'text'];
   const text=atPath(candidate,path);if(typeof text!=='string'||text.slice(e.start,e.end)!==e.excerpt)return [];
   const ids=direct?u.event.facts.map(f=>f.id):atPath(candidate,[...path.slice(0,-1),'factIds']);if(!Array.isArray(ids)||!ids.every(x=>typeof x==='string'))return [];
   const target=propositionTargets(review.candidate).find(t=>t.id===a.targetId);if(!target)return [];
   const issues=review.authority.judgments.flatMap(j=>j.issues).filter(i=>i.candidateEvidence.unitId===e.unitId&&i.candidateEvidence.start<e.end&&i.candidateEvidence.end>e.start);
   const allowed:Record<string,string[]>={TEMPORAL:['TEMPORAL_CONTINUITY','PHASE'],ATTRIBUTION:['ATTRIBUTION'],ENTITY:['ATTRIBUTION','ENTITY_RELATION'],PURPOSE:['PURPOSE','MISSING_SUPPORT'],CAUSE:['CAUSE','MISSING_SUPPORT'],CONSEQUENCE:['CONSEQUENCE','MISSING_SUPPORT'],MODALITY:['CERTAINTY'],POLARITY:['POLARITY'],OTHER:['MISSING_SUPPORT']};
   const matched=issues.find(i=>allowed[defect.kind]?.includes(i.kind));if(!matched)return [];
   const structuredKind=defect.kind==='OTHER'?matched.kind:defect.kind;
   const d=groundedRepairDiagnostic('UNSUPPORTED_ASSERTION',path,candidate,u,ids,structuredKind,source);if(!d)return [];
   // Exact diagnosed candidate spans only. All other characters are immutable.
   const same=review.authority.assessments.filter(x=>x.state==='UNSUPPORTED').flatMap(x=>x.defects).map(x=>x.candidateEvidence).filter(x=>x.unitId===id);
   const editable=new Uint8Array(text.length);same.forEach(s=>editable.fill(1,s.start,s.end));
   const immutable:string[]=[];let start=0;for(let i=0;i<=text.length;i++){if(i===text.length||editable[i]){if(i>start)immutable.push(text.slice(start,i));start=i+1;}}
   d.immutableText=immutable;d.cause='STRUCTURED_'+structuredKind;
   if(!ds.some(x=>x.path.join('.')===d.path.join('.')&&x.cause===d.cause))ds.push(d);
  }
 }
 return ds;
}
export function enforcePropositionReview(review:PropositionReview,source:string,u:Understanding,candidate:unknown,direct:boolean){
 // Revalidate stored identities before trusting any gate result.
 const catalog=freezeSourceCatalog(review.source);
 if(review.source.units.length!==1||review.source.units[0].text!==source||catalog.digest!==review.catalogDigest||review.identity!==propositionRequestIdentity(review.source,review.candidate,catalog))throw new ProcessingError('PROPOSITION_RECEIPT_INVALID');
 const result=reconcilePropositions(review.assessor,review.comparator,catalog,review.candidate,review.catalogDigest);
 if(result.verdict==='SUPPORTED'){
  const expected=direct?(candidate as {article:{title:string;body:string}}).article:undefined;
  const proposal=!direct?(candidate as {publication:{title:{text:string};body:{text:string}[]}}).publication:undefined;
  const units=expected?[{id:'title',text:expected.title},...(expected.body?[{id:'body:1',text:expected.body}]:[])]:proposal?[{id:'title',text:proposal.title.text},...proposal.body.map((p,i)=>({id:'body:'+(i+1),text:p.text}))]:[];
  if(structuralHash(units)!==structuralHash(review.candidate.units))throw new ProcessingError('PROPOSITION_RECEIPT_INVALID');return;
 }
 const diagnostics=result.verdict==='UNSUPPORTED'?propositionRepairDiagnostics({...review,...result},source,u,candidate,direct):[];
 if(!diagnostics.length)throw new ProcessingError(result.verdict==='UNSUPPORTED'?'PROPOSITION_UNSUPPORTED':'PROPOSITION_UNCERTAIN');
 throw new ProcessingError('DIRECT_PUBLICATION_UNSUPPORTED',false,{stage:direct?'direct_combined':'draft',issues:diagnostics.map(d=>({code:d.code,path:d.path})),repairDiagnostics:diagnostics,output:candidate});
}
/** Persist a compact acceptance binding with understanding; full audit payloads
 * already live in successful provider checkpoints, not duplicated DB blobs. */
export function propositionReceipt(review:PropositionReview){return {version:PROPOSITION_VERSION,identity:review.identity,sourceHash:structuralHash(review.source.units[0].text),publicationHash:structuralHash(review.candidate.units),catalogDigest:review.catalogDigest,verdict:'SUPPORTED' as const};}
