import {z} from 'zod';
import {ProcessingError} from './contracts';
import {sourceUnits} from './source-units';
import {resolveContextEvidence} from './groq-validation';
import {canonicalPresentationPrefixLength} from './newsroom-format';

import {fidelityLedgerSchema,temporalComparisonSchema} from './fidelity-ledger-contract';
export {fidelityLedgerSchema} from './fidelity-ledger-contract';
export type PublicationUnit={id:string;text:string};
export const temporalReviewInstructions=`Audit SOURCE FIRST: fill sourceCoverage for EVERY original unit before judging candidate claims. Each PRESERVED material source unit requires temporal comparisons against the complete corresponding candidate clauses, naming their publicationId. A background/context unit needs its OWN comparisons even when another unit states the main event. Do not transfer the main event time to its context. Read that original unit first and classify its asserted time, phase, continuity and certainty; then independently classify the corresponding candidate proposition. Compare semantic meaning, NOT grammatical tense: journalistic present may refer to the same completed past event if context establishes it. Split different propositions/time states. Evidence copying is separate from semantic explanation: sourceExcerpt is ONE SHORT CONTIGUOUS EXACT substring of the original source unit for this row; candidateExcerpt is ONE SHORT CONTIGUOUS EXACT substring of the candidate publicationId. Copy directly from the supplied text, including the words that establish time/continuity/modality and enough context to identify the activity. Do not quote an entire paragraph unnecessarily. Never abbreviate, splice nonadjacent fragments, insert three dots (...) or an ellipsis character (…), paraphrase, translate, or borrow wording from the opposite text in an excerpt. Only explanation may paraphrase. If several separate clauses need analysis, return separate comparisons with individually exact excerpts. Before returning, check each excerpt against its own supplied text; inserted ellipses are invalid, even when the intended meaning is faithful. Literal punctuation already present in the exact source/candidate is not invented evidence. A comparison must not omit a modifier that changes time, continuity or certainty. The separate claims ledger accounts for every candidate word; temporal comparisons account for the source propositions, not typography or reporting connectors. PAST vs PRESENT, planned vs occurring, expected/possible vs asserted, completed vs ongoing, and unspecified duration vs asserted continuity are material differences. Past progressive establishes past activity, NOT continuation now. Do not infer continuation because the source did not say it ended. BOUNDED means explicitly limited, not assumed ending. UNSPECIFIED means absent evidence for that dimension, never permission to ignore an explicit one. Certainty describes the claim inside its attribution, not independent truth. CHANGED or UNCERTAIN must not yield a supported publication. Truly non-material presentation units have no comparisons. No speculation, repair, invented evidence, or literal-translation requirement.`;
export const fidelityLedgerInstructions=`Return an independent fidelityLedger, not generator attestations. Split EVERY title/body factual assertion, qualifier and contextual clause into exact candidate excerpts. For each, identify original source unit IDs and explain semantic support or the precise unsupported change. All candidate wording must be accounted for, including introductory/background/concluding clauses. Source unit IDs refer ONLY to persisted originalSource, never generated extraction/translation. Check each claim's actor, action, object, attribution, relationship, time/place, quantity/unit, negation, uncertainty and causality. Same words or fact IDs do not establish equivalence. A numeric value attached to another entity is wrong. Translation or indirect speech can differ literally but must preserve meaning, attribution and direct/indirect speech status; do not invent direct quotes. For every original source unit separately report preserved material meaning and the supporting publication IDs, genuinely non-material presentation, missing meaning, or uncertainty. Repeated headings may share a preserved claim; do not invent extra facts to fill coverage. NON_MATERIAL_PRESENTATION is NOT permission to omit a unique assertion, qualification, condition, speaker or material number. Unsupported additions and material omissions fail even if extraction omitted them. Never accept generated Iran context absent from the source. Check temporal aspect explicitly: past activity does not establish that it continues now; planned activity is not completion; repetition is not continuity. Split these qualifiers into separately assessed claims rather than accepting a whole paragraph on topic similarity. Be adversarial: explicitly justify every assertion and every source disposition against the full source, not a blanket success.`+' ' +temporalReviewInstructions;

export function fidelityLedgerSchemaFor(source:string,publication:PublicationUnit[]){
 const units=sourceUnits(source).map(u=>u.id),ids=publication.map(p=>p.id);
 if(!units.length||!ids.length)throw new ProcessingError('SOURCE_TEXT_REQUIRED');
 return fidelityLedgerSchema.extend({
  claims:z.array(fidelityLedgerSchema.shape.claims.element.extend({publicationId:z.enum(ids),sourceUnitIds:z.array(z.enum(units)).min(1)})).min(1).max(200),
  sourceCoverage:z.array(fidelityLedgerSchema.shape.sourceCoverage.element.extend({unitId:z.enum(units),publicationIds:z.array(z.enum(ids)),temporal:z.array(temporalComparisonSchema.extend({publicationId:z.enum(ids)})).max(30)})).length(units.length),
 });
}
export function validateFidelityLedger(source:string,publication:PublicationUnit[],raw:unknown){
 const parsed=fidelityLedgerSchemaFor(source,publication).safeParse(raw);
 const fail=(code:string,path:(string|number)[]):never=>{throw new ProcessingError('INDEPENDENT_FIDELITY_FAILED',false,{stage:'publication_review',issues:[{code,path}]});};
 if(!parsed.success)return fail('INVALID_FIDELITY_LEDGER',['fidelityLedger']);
 const ledger=parsed.data,units=sourceUnits(source);
 if(new Set(ledger.sourceCoverage.map(r=>r.unitId)).size!==units.length)return fail('INCOMPLETE_SOURCE_ACCOUNTING',['fidelityLedger','sourceCoverage']);
 // Reconcile primary source coverage and additional explicit claim links;
 // neither semantic verdict nor source identity is changed by this union.
 for(const claim of ledger.claims)for(const id of claim.sourceUnitIds){const row=ledger.sourceCoverage.find(r=>r.unitId===id)!;if(!row.publicationIds.includes(claim.publicationId))row.publicationIds.push(claim.publicationId);}
 for(const [i,row] of ledger.sourceCoverage.entries()){
  if(row.disposition==='MISSING'||row.disposition==='UNCERTAIN')return fail('MATERIAL_SOURCE_NOT_PRESERVED',['fidelityLedger','sourceCoverage',i]);
  if(row.disposition==='PRESERVED'&&(!row.publicationIds.length||!row.temporal.length)||row.disposition==='NON_MATERIAL_PRESENTATION'&&(row.publicationIds.length||row.temporal.length))return fail('INCONSISTENT_SOURCE_ACCOUNTING',['fidelityLedger','sourceCoverage',i]);
  const unit=units.find(u=>u.id===row.unitId)!;
  for(const [j,comparison] of row.temporal.entries()){
   const path=['fidelityLedger','sourceCoverage',i,'temporal',j];
   if(!unit.text.includes(comparison.sourceExcerpt))return fail('INVALID_TEMPORAL_SOURCE',path);
   if(!row.publicationIds.includes(comparison.publicationId))return fail('INVALID_TEMPORAL_PUBLICATION',path);
   const p=publication.find(p=>p.id===comparison.publicationId)!;
   const span={excerpt:comparison.candidateExcerpt,context:p.text,start:0,end:0};
   try{resolveContextEvidence(span,p.text);}catch{return fail('INVALID_TEMPORAL_CANDIDATE',path);}
   if(comparison.assessment!=='PRESERVED'||(['time','phase','continuity','certainty'] as const).some(k=>comparison.sourceState[k]!==comparison.candidateState[k]))return fail('TEMPORAL_SCOPE_CHANGE',path);
  }
 }
 for(const p of publication){
  const mask=new Uint8Array(p.text.length);
  mask.fill(1,0,canonicalPresentationPrefixLength(source,p.text));
  for(const [i,claim] of ledger.claims.entries()){
   if(claim.publicationId!==p.id)continue;
   if(claim.verdict!=='SUPPORTED')return fail('UNSUPPORTED_CANDIDATE_CLAIM',['fidelityLedger','claims',i]);
   const occurrence={excerpt:claim.excerpt,context:p.text,start:0,end:0};
   try{resolveContextEvidence(occurrence,p.text);}catch{return fail('INVALID_CANDIDATE_OCCURRENCE',['fidelityLedger','claims',i,'excerpt']);}
   const start=occurrence.start;claim.excerpt=occurrence.excerpt;
   if(claim.sourceUnitIds.some(id=>!ledger.sourceCoverage.some(row=>row.unitId===id&&row.disposition==='PRESERVED')))return fail('INCONSISTENT_CLAIM_SUPPORT',['fidelityLedger','claims',i]);
   mask.fill(1,start,start+claim.excerpt.length);
  }
  // Mechanical coverage of generated words, never a literal source comparison.
  for(let i=0;i<p.text.length;i++)if(!mask[i]&&/[\p{L}\p{N}]/u.test(p.text[i]))return fail('UNREVIEWED_CANDIDATE_WORDS',['publication',p.id]);
 }
 return ledger;
}
