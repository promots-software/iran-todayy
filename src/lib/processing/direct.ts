import {iranNowStyleInstructions} from './iran-now-style';
import {z} from 'zod';
import {minimalExtractionSchema,validateMinimalExtraction,requireCompleteExtraction} from './groq-extraction';
import {classificationReferences,adaptIdClassification} from './id-classification';
import {ProcessingError} from './contracts';
import type {RenderingReceipt} from './rendering-contract';
import {directCoverageSchema,directProposalSchema} from './direct-publication-contract';
import {extractionTask,uniqueContextInstructions} from './gemini-benchmark-prompt';

// No scope, relevance or geography decision is requested. Safety labels remain
// attached to their original assertion, then receive immutable IDs locally.
const literalEvidence=minimalExtractionSchema.shape.actors.element;
export function directStatementSchema<T extends typeof literalEvidence>(e:T){return z.union([
 z.object({evidence:e,speaker:z.null(),kind:z.enum(['FACT','FIGURE','DECISION','OUTCOME']),material:z.boolean()}).strict(),
 z.object({evidence:e,speaker:e,kind:z.enum(['CLAIM','STATEMENT','FIGURE','DECISION','OUTCOME']),material:z.boolean()}).strict(),
]);}
export const directExtractionSchema=minimalExtractionSchema.omit({relevance:true}).extend({
 statements:z.array(directStatementSchema(literalEvidence)).max(100),
 safety:z.object({filterReason:z.enum(['NONE','ADVERTISING','SATIRE','RUMOUR','OPINION','INCITEMENT']),
  priority:z.enum(['P1','P2','P3','P4']),sensitiveActor:z.boolean(),leaderDeath:z.boolean(),seriousClaim:z.boolean(),rankUnverified:z.boolean(),
 }).strict(),
}).strict();
export const directInstructions=extractionTask.replace('Extract only verbatim source spans and relevance.','Extract only verbatim source spans.').replaceAll('POLITICAL_NEWS','source-approved content')+' '+uniqueContextInstructions+
 ' The authenticated source administrator has already decided that all source content is in scope. Do not classify relevance, geography, target keywords or political importance. No relevance or topic fields are permitted. Extract faithfully even outside the normal geography. Safety labels describe only the supplied assertions: distinguish advertisements, satire, rumours, opinion and incitement without treating ordinary news outside the geography as unsafe. Each statement retains its kind and material-change label. Unattributed narration may be FACT, FIGURE, DECISION or OUTCOME, never CLAIM/STATEMENT without an explicit validated speaker. Attributed speech may be CLAIM, STATEMENT, FIGURE, DECISION or OUTCOME, never an unattributed FACT. Preserve serious-claim, leader-death, sensitive-actor and unresolved-rank flags; never declare correctness or verification. Choose priority by urgency only, not scope. P4 is for genuinely archive-only material, never merely unrecognized geography. No inferred relationships, identities or ownership.';
export function validateDirectExtraction(raw:unknown,source:string){
 const parsed=directExtractionSchema.safeParse(raw);
 if(!parsed.success)throw new ProcessingError('INVALID_DIRECT_EXTRACTION_SCHEMA');
 const {safety,statements,...anchors}=parsed.data;
 const extraction=validateMinimalExtraction({...anchors,relevance:'POLITICAL_NEWS',statements:statements.map(({evidence,speaker})=>({evidence,speaker}))},source);
 requireCompleteExtraction(extraction,source);
 const refs=classificationReferences(extraction);
 const classification={...safety,topic:'UNKNOWN',topicEvidenceId:null,anchorIds:refs.requiredAnchorIds,
  factLabels:statements.map((s,i)=>({id:extraction.statements[i].id,kind:s.kind,material:s.material})),rationaleIds:refs.requiredFactIds};
 return {extraction,classification};
}
export function adaptDirectExtraction(value:ReturnType<typeof validateDirectExtraction>,source:string,rendering?:RenderingReceipt){
 // Reuse the complete strict ID/speaker/evidence/rendering validators.
 return adaptIdClassification(value.extraction,value.classification,source,rendering);
}

export const directArabicSchema=directExtractionSchema.extend({coverage:directCoverageSchema,publication:directProposalSchema}).strict();
export const directArabicInstructions=directInstructions.replace('Do not generate summary, translations, invented factual prose, IDs, keys, offsets or verification.','Do not invent facts, offsets or verification. Verbatim extraction and publication proposal are separate.')+
 ' In the SAME response return coverage and an UNTRUSTED publication proposal. Evidence stays verbatim. Statement IDs are f1, f2, ... in array order: use those references for title/body and source-unit coverage; never invent an ID. Every supplied sourceUnit must be mapped to all its material fact IDs. Non-factual is permitted only for standalone URL/handle lines, never narrative, final sentences, future announcements, qualifiers or conditions. Extract every material assertion including the last sentence. Return a concise informative Modern Standard Arabic title and body sentences when warranted, each with supporting factIds. Preserve all facts, names, dates, numbers, locations, purposes, uncertainty, conditions, attribution and literal quotes. Improve awkward grammar and colloquial prose, avoid repetition/analysis/sensationalism and attribution-only headlines. A clean short flash may stay close to its source, with body=[]. Do not include branding or hashtags; application adds branding once. Do not add عاجل. A same-call rewrite is NOT validated by you. Broad paraphrase is independently reviewed. A speaker-bearing fact may NEVER use kind FACT: choose STATEMENT/DECISION/OUTCOME/etc only as supported. No model attestations. Do not truncate; fail rather than omit material content to fit.'+'\n'+iranNowStyleInstructions;
