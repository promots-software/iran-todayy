import {z} from 'zod';
import {minimalExtractionSchema,validateMinimalExtraction,requireCompleteExtraction} from './groq-extraction';
import {classificationReferences,adaptIdClassification} from './id-classification';
import {ProcessingError} from './contracts';
import type {RenderingReceipt} from './rendering-contract';
import {extractionTask,uniqueContextInstructions} from './gemini-benchmark-prompt';

// No scope, relevance or geography decision is requested. Safety labels remain
// attached to their original assertion, then receive immutable IDs locally.
export const directExtractionSchema=minimalExtractionSchema.omit({relevance:true}).extend({
 statements:z.array(minimalExtractionSchema.shape.statements.element.extend({
  kind:z.enum(['FACT','CLAIM','FIGURE','DECISION','OUTCOME','STATEMENT']),material:z.boolean(),
 }).strict()).max(100),
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
 requireCompleteExtraction(extraction);
 const refs=classificationReferences(extraction);
 const classification={...safety,topic:'UNKNOWN',topicEvidenceId:null,anchorIds:refs.requiredAnchorIds,
  factLabels:statements.map((s,i)=>({id:extraction.statements[i].id,kind:s.kind,material:s.material})),rationaleIds:refs.requiredFactIds};
 return {extraction,classification};
}
export function adaptDirectExtraction(value:ReturnType<typeof validateDirectExtraction>,source:string,rendering?:RenderingReceipt){
 // Reuse the complete strict ID/speaker/evidence/rendering validators.
 return adaptIdClassification(value.extraction,value.classification,source,rendering);
}
