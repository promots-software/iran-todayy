import {z} from 'zod';
const text=z.string().min(1).max(20000);
export const renderingChecks=['scope','entitiesAndRelationships','namesAndTitles','numbers','attribution','negationAndModality','literalQuotes'] as const;
export const renderingEntrySchema=z.object({id:text,arabic:text}).strict();
export const renderingReviewSchema=z.object({id:text,verdict:z.enum(['SUPPORTED','UNSUPPORTED','UNCERTAIN']),checks:z.object(Object.fromEntries(renderingChecks.map(k=>[k,z.boolean()])) as Record<typeof renderingChecks[number],z.ZodBoolean>).strict(),issues:z.array(text)}).strict();
export const fullSourceCoverageSchema=z.object({version:z.literal('direct-full-source-v1'),sourceHash:text,complete:z.literal(true),units:z.array(z.object({id:text,verdict:z.enum(['COVERED','NON_FACTUAL','MISSING','UNCERTAIN']),factIds:z.array(text),reason:text}).strict()).min(1)}).strict();
export const renderingReceiptSchema=z.object({version:z.literal('evidence-arabic-v1'),sourceHash:text,entries:z.array(renderingEntrySchema),review:z.array(renderingReviewSchema),fullSourceCoverage:fullSourceCoverageSchema.optional()}).strict();
export type RenderingReceipt=z.infer<typeof renderingReceiptSchema>;

// Only explicitly typed soft diagnostics are non-blocking. Unknown issues fail closed.
const softReviewIssues=new Set(['SOFT:STYLE','SOFT:CONTEXT_PRESERVED','SOFT:RELEVANCE','SOFT:TERMINOLOGY_PRESERVED','SOFT:QUOTE_FORMAT','SOFT:ENRICHMENT_UNAVAILABLE']);
export const isSoftReviewIssue=(issue:string)=>softReviewIssues.has(issue);
export function factualReviewPassed(review:z.infer<typeof renderingReviewSchema>){
 return renderingChecks.every(k=>review.checks[k])&&review.issues.every(isSoftReviewIssue)&&
  (review.verdict==='SUPPORTED'||(review.verdict==='UNCERTAIN'&&review.issues.length>0));
}
export const factualReviewInstructions='Acceptance is authoritative: do not re-evaluate geographical relevance, editorial interest, source identity/viewpoint or category. The scope check means preservation of MATERIAL factual meaning, never publication scope. Preserve ambiguity as ambiguity; no enrichment is required. Report soft-only diagnostics using exactly SOFT:STYLE, SOFT:CONTEXT_PRESERVED, SOFT:RELEVANCE, SOFT:TERMINOLOGY_PRESERVED, SOFT:QUOTE_FORMAT or SOFT:ENRICHMENT_UNAVAILABLE. These do not fail factual checks or make a faithful rendering UNSUPPORTED. Actual added/missing facts, changed people/numbers/dates, lost attribution, reversed meaning, uncertainty upgrades and invented literal quotes must fail their factual checks. Use unprefixed issues for factual failures; never label a material problem soft.';
