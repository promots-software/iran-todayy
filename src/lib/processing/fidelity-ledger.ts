import {z} from 'zod';
import {ProcessingError} from './contracts';
import {sourceUnits} from './source-units';
import {resolveContextEvidence} from './groq-validation';
import {canonicalPresentationPrefixLength} from './newsroom-format';

import {fidelityLedgerSchema,temporalComparisonSchema} from './fidelity-ledger-contract';
export {fidelityLedgerSchema} from './fidelity-ledger-contract';
export type PublicationUnit={id:string;text:string};
export const temporalReviewInstructions=`Audit SOURCE FIRST: fill sourceCoverage for EVERY original unit before judging candidate claims. Each PRESERVED material source unit requires temporal comparisons against the complete corresponding candidate clauses, naming their publicationId. A background/context unit needs its OWN comparisons even when another unit states the main event. Do not transfer the main event time to its context. Read that original unit first and classify its asserted time, phase, continuity and certainty; then independently classify the corresponding candidate proposition. Compare semantic meaning, NOT grammatical tense: journalistic present may refer to the same completed past event if context establishes it. Split different propositions/time states. Evidence copying is separate from semantic explanation: sourceExcerpt is ONE SHORT CONTIGUOUS EXACT substring of the original source unit for this row; candidateExcerpt is ONE SHORT CONTIGUOUS EXACT substring of the candidate publicationId. Copy directly from the supplied text, including the words that establish time/continuity/modality and enough context to identify the activity. Do not quote an entire paragraph unnecessarily. Never abbreviate, splice nonadjacent fragments, insert three dots (...) or an ellipsis character (…), paraphrase, translate, or borrow wording from the opposite text in an excerpt. Only explanation may paraphrase. If several separate clauses need analysis, return separate comparisons with individually exact excerpts. Before returning, check each excerpt against its own supplied text; inserted ellipses are invalid, even when the intended meaning is faithful. Literal punctuation already present in the exact source/candidate is not invented evidence. A comparison must not omit a modifier that changes time, continuity or certainty. The separate claims ledger accounts for every candidate word; temporal comparisons account for the source propositions, not typography or reporting connectors. States describe event meaning, not morphology. Equivalent syntax requires identical semantic states; actual changes in time, completion, continuity or certainty are material. PRESERVED with contradictory states is an invalid review receipt. Past progressive establishes past activity, NOT continuation now. Do not infer continuation because the source did not say it ended. BOUNDED means explicitly limited, not assumed ending. UNSPECIFIED means absent evidence for that dimension, never permission to ignore an explicit one. Certainty describes the claim inside its attribution, not independent truth. CHANGED requires an UNSUPPORTED claim for the same source unit, publication and overlapping candidate proposition, explaining the material temporal difference. Other unrelated supported claims may coexist. If your claims support that same temporal proposition, reconcile the review instead of inventing an article defect. CHANGED or UNCERTAIN must not yield a supported publication. Truly non-material presentation units have no comparisons. No speculation, repair, invented evidence, or literal-translation requirement.`;
export const fidelityLedgerInstructions=`Return an independent fidelityLedger, not generator attestations. Each claim MUST contain components: independently assessable MATERIAL SEMANTIC ASSERTIONS, not words or mechanically split grammatical clauses. Component id must be globally unique. Parent publicationId is inherited. Each component has an exact contiguous candidate excerpt, linked original sourceUnitIds, verdict and concise source-based explanation. Components may overlap to include necessary context; together account for all parent prose. Split distinct purposes, actions, outcomes, relationships and qualifiers even within one sentence. PLAUSIBILITY IS NOT SUPPORT. SAME TOPIC IS NOT SUPPORT. SUPPORT FOR A DOES NOT ESTABLISH ADDITIONAL B. If a publication asserts A+B and source supports only A, independently assess B as UNSUPPORTED; do not endorse the compound on the strength of A. Do not infer purpose, agenda, development, cooperation, consequence, motive, scope, relationship, attribution, certainty or temporal state merely because plausible. Faithful paraphrase/translation of one proposition may use one component regardless of word count, syntax, order or morphology. Parent verdict aggregates components: UNSUPPORTED if any UNSUPPORTED, otherwise UNCERTAIN if any UNCERTAIN, otherwise SUPPORTED. Source-unit links equal the union of component links. Missing/invalid component accounting is a receipt defect, not an article defect. Split EVERY title/body factual assertion, qualifier and contextual clause into exact candidate excerpts. For each, identify original source unit IDs and explain semantic support or the precise unsupported change. All candidate wording must be accounted for, including introductory/background/concluding clauses. Source unit IDs refer ONLY to persisted originalSource, never generated extraction/translation. Check each claim's actor, action, object, attribution, relationship, time/place, quantity/unit, negation, uncertainty and causality. Same words or fact IDs do not establish equivalence. A numeric value attached to another entity is wrong. Translation or indirect speech can differ literally but must preserve meaning, attribution and direct/indirect speech status; do not invent direct quotes. For every original source unit separately report preserved material meaning and the supporting publication IDs, genuinely non-material presentation, missing meaning, or uncertainty. Repeated factual headings must be PRESERVED and may share a preserved claim; NON_MATERIAL_PRESENTATION cannot support factual claims; do not invent extra facts to fill coverage. NON_MATERIAL_PRESENTATION is NOT permission to omit a unique assertion, qualification, condition, speaker or material number. Unsupported additions and material omissions fail even if extraction omitted them. Never accept generated Iran context absent from the source. Check temporal aspect explicitly: past activity does not establish that it continues now; planned activity is not completion; repetition is not continuity. Split these qualifiers into separately assessed claims rather than accepting a whole paragraph on topic similarity. Be adversarial: explicitly justify every assertion and every source disposition against the full source, not a blanket success.`+' ' +temporalReviewInstructions;

export function fidelityLedgerSchemaFor(source:string,publication:PublicationUnit[]){
 const units=sourceUnits(source).map(u=>u.id),ids=publication.map(p=>p.id);
 if(!units.length||!ids.length)throw new ProcessingError('SOURCE_TEXT_REQUIRED');
 return fidelityLedgerSchema.extend({
  claims:z.array(fidelityLedgerSchema.shape.claims.element.extend({publicationId:z.enum(ids),sourceUnitIds:z.array(z.enum(units)).min(1),components:z.array(fidelityLedgerSchema.shape.claims.element.shape.components.element.extend({sourceUnitIds:z.array(z.enum(units)).min(1)})).min(1).max(100)})).min(1).max(200),
  sourceCoverage:z.array(fidelityLedgerSchema.shape.sourceCoverage.element.extend({unitId:z.enum(units),publicationIds:z.array(z.enum(ids)),temporal:z.array(temporalComparisonSchema.extend({publicationId:z.enum(ids)})).max(30)})).length(units.length),
 });
}
/** Receipt integrity precedes semantic verdicts and article repair diagnosis. */
export function validateFidelityReceipt(source:string,publication:PublicationUnit[],raw:unknown){
 const parsed=fidelityLedgerSchemaFor(source,publication).safeParse(raw);
 const fail=(code:string,path:(string|number)[]):never=>{throw new ProcessingError('REVIEW_RECEIPT_INVALID',false,{stage:'publication_review',issues:[{code,path}]});};
 if(!parsed.success)return fail('INVALID_FIDELITY_LEDGER',['fidelityLedger']);
 const ledger=parsed.data,units=sourceUnits(source);
 if(new Set(ledger.sourceCoverage.map(r=>r.unitId)).size!==units.length)return fail('INCOMPLETE_SOURCE_ACCOUNTING',['fidelityLedger','sourceCoverage']);
 for(const [i,row] of ledger.sourceCoverage.entries()){
  const path=['fidelityLedger','sourceCoverage',i];
  const linked=ledger.claims.filter(c=>c.sourceUnitIds.includes(row.unitId));
  // Union redundant links only for an explicitly preserved factual row. Never
  // convert presentation/missing/uncertain material into supported facts.
  if(row.disposition==='PRESERVED')for(const claim of linked)if(!row.publicationIds.includes(claim.publicationId))row.publicationIds.push(claim.publicationId);
  if(new Set(row.publicationIds).size!==row.publicationIds.length)return fail('DUPLICATE_PUBLICATION_ID',path);
  if(row.disposition==='PRESERVED'&&(!row.publicationIds.length||!row.temporal.length)||row.disposition==='NON_MATERIAL_PRESENTATION'&&(row.publicationIds.length||row.temporal.length||linked.length))return fail('INCONSISTENT_SOURCE_ACCOUNTING',path);
  if(row.disposition==='PRESERVED'&&linked.some(c=>!row.publicationIds.includes(c.publicationId)))return fail('INCONSISTENT_CLAIM_SUPPORT',path);
  const unit=units.find(u=>u.id===row.unitId)!;
  for(const [j,t] of row.temporal.entries()){
   const at=[...path,'temporal',j];
   if(!unit.text.includes(t.sourceExcerpt))return fail('INVALID_TEMPORAL_SOURCE',at);
   if(!row.publicationIds.includes(t.publicationId))return fail('INVALID_TEMPORAL_PUBLICATION',at);
   const p=publication.find(p=>p.id===t.publicationId)!;
   try{resolveContextEvidence({excerpt:t.candidateExcerpt,context:p.text},p.text);}catch{return fail('INVALID_TEMPORAL_CANDIDATE',at);}
   // Semantic states must be coherent. Do not infer article defects from morphology.
   if(t.assessment==='PRESERVED'&&(['time','phase','continuity','certainty'] as const).some(k=>t.sourceState[k]!==t.candidateState[k]))return fail('INCONSISTENT_TEMPORAL_ASSESSMENT',at);
   if(t.assessment==='CHANGED'){
    // Resolve relationships by publication, source unit and exact candidate range.
    // Supported unrelated claims do not contradict a separately rejected qualifier.
    const occurrence={excerpt:t.candidateExcerpt,context:p.text,start:0,end:0};
    resolveContextEvidence(occurrence,p.text);
    const corresponding=linked.filter(c=>c.publicationId===t.publicationId).filter(c=>{
     const span={excerpt:c.excerpt,context:p.text,start:0,end:0};
     try{resolveContextEvidence(span,p.text);}catch{return false;}
     return span.start<occurrence.end&&span.end>occurrence.start;
    });
    if(!corresponding.some(c=>c.verdict==='UNSUPPORTED'))return fail('INCONSISTENT_TEMPORAL_CLAIM_SUPPORT',at);
   }
  }
 }
 const componentIds=new Set<string>();
 for(const [i,c] of ledger.claims.entries()){
  const path=['fidelityLedger','claims',i,'components'];
  const p=publication.find(p=>p.id===c.publicationId)!;
  const parent={excerpt:c.excerpt,context:p.text,start:0,end:0};
  try{resolveContextEvidence(parent,p.text);}catch{return fail('INVALID_CANDIDATE_OCCURRENCE',path);}
  const mask=new Uint8Array(c.excerpt.length);
  // Apply the existing canonical-prefix exemption at the component boundary too.
  // Only the actual publication prefix is presentation; interior prose is not.
  if(parent.start===0)mask.fill(1,0,Math.min(mask.length,canonicalPresentationPrefixLength(source,p.text)));
  for(const [j,part] of c.components.entries()){
   if(componentIds.has(part.id))return fail('DUPLICATE_COMPONENT_ID',[...path,j]);componentIds.add(part.id);
   if(new Set(part.sourceUnitIds).size!==part.sourceUnitIds.length||part.sourceUnitIds.some(id=>!c.sourceUnitIds.includes(id)))return fail('INVALID_COMPONENT_SOURCE_LINK',[...path,j]);
   const span={excerpt:part.excerpt,context:p.text,start:0,end:0};
   try{resolveContextEvidence(span,p.text);}catch{return fail('INVALID_COMPONENT_OCCURRENCE',[...path,j]);}
   if(span.start<parent.start||span.end>parent.end)return fail('COMPONENT_OUTSIDE_PARENT',[...path,j]);
   mask.fill(1,span.start-parent.start,span.end-parent.start);
  }
  if(c.sourceUnitIds.some(id=>!c.components.some(part=>part.sourceUnitIds.includes(id))))return fail('INCOMPLETE_COMPONENT_SOURCE_LINK',path);
  for(let j=0;j<c.excerpt.length;j++)if(!mask[j]&&/[\p{L}\p{N}]/u.test(c.excerpt[j]))return fail('INCOMPLETE_COMPONENT_ACCOUNTING',path);
  const aggregate=c.components.some(p=>p.verdict==='UNSUPPORTED')?'UNSUPPORTED':c.components.some(p=>p.verdict==='UNCERTAIN')?'UNCERTAIN':'SUPPORTED';
  if(c.verdict!==aggregate)return fail('INCONSISTENT_COMPONENT_VERDICT',path);
 }
 for(const p of publication){
  const mask=new Uint8Array(p.text.length);mask.fill(1,0,canonicalPresentationPrefixLength(source,p.text));
  for(const [i,c] of ledger.claims.entries()){
   if(c.publicationId!==p.id)continue;
   if(new Set(c.sourceUnitIds).size!==c.sourceUnitIds.length)return fail('DUPLICATE_SOURCE_UNIT_ID',['fidelityLedger','claims',i]);
   const occurrence={excerpt:c.excerpt,context:p.text,start:0,end:0};
   try{resolveContextEvidence(occurrence,p.text);}catch{return fail('INVALID_CANDIDATE_OCCURRENCE',['fidelityLedger','claims',i,'excerpt']);}
   mask.fill(1,occurrence.start,occurrence.end);
  }
  // Reviewer must account for all generated prose; no lexical source matching.
  for(let i=0;i<p.text.length;i++)if(!mask[i]&&/[\p{L}\p{N}]/u.test(p.text[i]))return fail('UNREVIEWED_CANDIDATE_WORDS',['publication',p.id]);
 }
 return ledger;
}
export function validateFidelityLedger(source:string,publication:PublicationUnit[],raw:unknown){
 const ledger=validateFidelityReceipt(source,publication,raw);
 const fail=(code:string,path:(string|number)[]):never=>{throw new ProcessingError('INDEPENDENT_FIDELITY_FAILED',false,{stage:'publication_review',issues:[{code,path}]});};
 for(const [i,row] of ledger.sourceCoverage.entries()){
  if(row.disposition==='MISSING'||row.disposition==='UNCERTAIN')return fail('MATERIAL_SOURCE_NOT_PRESERVED',['fidelityLedger','sourceCoverage',i]);
  for(const [j,t] of row.temporal.entries())if(t.assessment!=='PRESERVED')return fail('TEMPORAL_SCOPE_CHANGE',['fidelityLedger','sourceCoverage',i,'temporal',j]);
 }
 for(const [i,c] of ledger.claims.entries()){
  if(c.verdict!=='SUPPORTED')return fail('UNSUPPORTED_CANDIDATE_CLAIM',['fidelityLedger','claims',i]);
  if(c.sourceUnitIds.some(id=>!ledger.sourceCoverage.some(r=>r.unitId===id&&r.disposition==='PRESERVED')))return fail('INCONSISTENT_CLAIM_SUPPORT',['fidelityLedger','claims',i]);
 }
 return ledger;
}
