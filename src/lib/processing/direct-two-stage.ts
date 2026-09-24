import {eventIdentitySchema,eventIdentityInstructions} from './event-identity';
import {fidelityLedgerSchemaFor} from './fidelity-ledger';
import {normalSelection,normalExtractionSchema} from './normal-v2';
import {z} from 'zod';
import {directExtractionSchema,directInstructions} from './direct';
import {directArticleSchema} from './direct-generation-contract';
import {directCoverageSchema,directPublicationReviewSchema} from './direct-publication-contract';
import {comparisonSchema,ProcessingError,type EventData,type Understanding} from './contracts';
import {directArticleInstructions,directComparisonKey} from './direct-generation';
export {directComparisonKey} from './direct-generation';
import {publicationReviewInstructions,publicationUnits} from './direct-publication';
import {sameValidatedEvent} from './matcher';

export const directCombinedSchema=z.object({extraction:directExtractionSchema.extend({coverage:directCoverageSchema,relevance:normalExtractionSchema.shape.relevance,contentType:normalExtractionSchema.shape.contentType,contentTypeEvidence:normalExtractionSchema.shape.contentTypeEvidence}),article:directArticleSchema.nullable()}).strict();
export const directCombinedInstructions=directInstructions.replace('Do not generate summary, translations, invented factual prose, IDs, keys or verification.','Evidence fields remain verbatim original-language spans. Arabic article prose belongs exclusively in the separate article object.')+' In this ONE response decide semantic Iran relevance/content type and return extraction AND article for accepted news. For IRRELEVANT, PURE_PROMO or UNCERTAIN return article=null, without generating publication copy. They are untrusted proposals, not a review. '+directArticleInstructions;
export const directIndependentSchema=directPublicationReviewSchema.extend({comparisons:z.array(z.object({id:z.string().min(1),decision:comparisonSchema}).strict()).max(1000)}).strict();
export const directIndependentInstructions=publicationReviewInstructions+' '+eventIdentityInstructions+' Independently review the complete canonical article, including translation equivalence for non-Arabic sources. Review title and body:1 (when body exists). Coverage must account for the FULL original source, not only extracted excerpts. Reject missing material assertions or invented background/padding. Do not rewrite. Independently compare incoming evidence with each supplied existing event for deduplication; return exactly its supplied comparison id and SAME/DIFFERENT/UNCERTAIN with incoming fact IDs. Event comparison never certifies truth or overrides the factual article review. Return no comparisons when none are supplied.';

export function directComparisonInputs(incoming:EventData,existing:EventData[]){
 const norm=(v:string)=>v.normalize('NFKC').toLowerCase().trim();
 const unique=new Map<string,{id:string;existing:EventData}>();
 for(const event of existing){
  // Same candidate eligibility as the existing matcher, no widened identity rule.
  const plausible=incoming.actors.some(a=>event.actors.some(b=>norm(a.key)===norm(b.key)))||incoming.facts.some(a=>event.facts.some(b=>norm(a.key)===norm(b.key)));
  if(!plausible||sameValidatedEvent(incoming,event))continue;
  const id=directComparisonKey(incoming,event);unique.set(id,{id,existing:event});
 }
 return [...unique.values()];
}
export function directIndependentInput(source:string,u:Understanding,article:z.infer<typeof directArticleSchema>,comparisons:ReturnType<typeof directComparisonInputs>){
 return {originalSource:source,sourceUnits:publicationUnits(source),validatedEvidence:u.event,validatedCoverage:u.semanticCoverage,publication:[{id:'title',text:article.title},...(article.body?[{id:'body:1',text:article.body}]:[])],incoming:u.event,comparisons};
}
export function validateDirectComparisons(raw:z.infer<typeof directIndependentSchema>,inputs:ReturnType<typeof directComparisonInputs>,u:Understanding){
 const ids=new Set(u.event.facts.map(f=>f.id));
 if(raw.comparisons.length!==inputs.length||new Set(raw.comparisons.map(c=>c.id)).size!==inputs.length||raw.comparisons.some(c=>!inputs.some(i=>i.id===c.id)||[...c.decision.newFactIds,...c.decision.conflictingFactIds].some(id=>!ids.has(id))))throw new ProcessingError('INVALID_COMPARISON_EVIDENCE');
 return new Map(raw.comparisons.map(c=>[c.id,c.decision]));
}

export function directSelection(raw:z.infer<typeof directCombinedSchema>,source:string){
 const {safety:ignored,statements,...rest}=raw.extraction;void ignored;
 return normalSelection({...rest,statements:statements.map(({evidence,speaker})=>({evidence,speaker}))},source);
}
export function directIndependentSchemaFor(data:{originalSource:string;publication:{id:string;text:string}[];comparisons:{id:string}[]}){
 const ids=data.publication.map(p=>p.id);
 if(!ids.length)throw new ProcessingError('DIRECT_PUBLICATION_REVIEW_FAILED');
 const comparison=directIndependentSchema.shape.comparisons.element.extend({decision:comparisonSchema.extend({identity:eventIdentitySchema})});
 return z.object({
  fidelityLedger:fidelityLedgerSchemaFor(data.originalSource,data.publication),
  ...directIndependentSchema.omit({fidelityLedger:true}).shape,
  review:z.array(directPublicationReviewSchema.shape.review.element.extend({id:z.enum(ids)})).length(ids.length),
  comparisons:data.comparisons.length?z.array(comparison.extend({id:z.enum(data.comparisons.map(c=>c.id))})).length(data.comparisons.length):z.array(comparison).max(0),
 }).strict();
}
