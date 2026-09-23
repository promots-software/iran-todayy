import {sourceCoverage,validateSourceCoverage} from './direct-publication';
import type {GroundedExtraction} from './groq-extraction';
import {z} from 'zod';
import {minimalExtractionSchema} from './groq-extraction';
import {ProcessingError,evidenceSchema,checkEvidence} from './contracts';
import {resolveContextEvidence} from './groq-validation';
export const normalExtractionSchema=minimalExtractionSchema.extend({
 contentType:z.enum(['NEWS','PURE_PROMO','UNCERTAIN']),
 contentTypeEvidence:z.object({excerpt:z.string().min(1).max(20000),context:z.string().min(1).max(20000)}).strict(),
}).strict();
export const newsworthinessInstructions='Extraction is the only stage allowed to choose source evidence; later rendering cannot extend immutable excerpts. Cover all source prose with complete contiguous verbatim assertions, including prefixes, qualifiers, endings and labels. Do not silently discard text as boilerplate; only standalone URLs/handles are locally exempt. Include surrounding prose in the exact assertion span when necessary; never fabricate a fallback fact. An explicit speaker excerpt must be the actual governing source span, not a later mention, inferred pronoun expansion or invented replacement. If speaker identity is unresolved, preserve the complete original attributed assertion as verbatim narration rather than inventing an identity. For colon headings preserve the full explicit speaker including source-stated qualifiers. NORMAL content selection: distinguish independent substantive news (events, decisions, actual statements, material developments) from PURE_PROMO (only an upcoming guest/program/interview announcement, broadcast schedule, watch invitation or teaser without substantive new information). A statement actually made in an interview is NEWS, never PURE_PROMO merely because television or an interview is mentioned. An announcement that someone WILL speak is not the substance they have actually said. Use full contextual understanding, not keywords. Return UNCERTAIN rather than guess. contentTypeEvidence must be verbatim source context supporting the decision. Preserve the separate existing Iran relevance decision. Source language/style quality is not a selection reason. Still extract all safe factual assertions verbatim.';
export function validateNormalExtractionCoverage(source:string,x:GroundedExtraction){
 const facts=x.statements.map(f=>({...f,speaker:f.speaker?{evidence:f.speaker}:null}));
 return validateSourceCoverage(source,{event:{facts}},sourceCoverage(source,facts));
}
export function normalSelection(raw:unknown,source:string){
 const p=normalExtractionSchema.safeParse(raw);if(!p.success)throw new ProcessingError('AI_INVALID_SCHEMA');
 const {contentType,contentTypeEvidence,...extraction}=p.data;
 const evidence={...contentTypeEvidence};resolveContextEvidence(evidence,source);checkEvidence(source,evidenceSchema.parse(evidence));
 return {contentType,extraction};
}
const repairable=new Set(['AI_INVALID_SCHEMA','GROQ_INVALID_SCHEMA','INVALID_ID_CLASSIFICATION','INVALID_CLASSIFICATION_RATIONALE_IDS','CLASSIFICATION_EVIDENCE_MISMATCH','INVALID_DRAFT_FACT_LINK','DIRECT_PUBLICATION_INVALID','DIRECT_MATERIAL_COVERAGE_FAILED','DIRECT_PUBLICATION_UNSUPPORTED','DIRECT_PUBLICATION_NUMBER_MISMATCH','DIRECT_PUBLICATION_DATE_MISMATCH','DIRECT_PUBLICATION_QUOTE_MISMATCH','DIRECT_PUBLICATION_ENTITY_ATTRIBUTION_MISMATCH','DIRECT_PUBLICATION_REVIEW_FAILED','DIRECT_UNINFORMATIVE_TITLE','AMBIGUOUS_EVIDENCE_CONTEXT','EVIDENCE_CONTEXT_REQUIRED','INVALID_EVIDENCE','INCOMPLETE_EXTRACTION','SPEAKER_ATTRIBUTION_MISMATCH','SPEAKER_ATTRIBUTION_REQUIRED']);
export type StageRepair={stage:string;code:string;issues:unknown;instructions:string};
/** One repair per stage. Transport/cost waits escape unchanged. Successful prior stages are not repeated. */
export async function normalStage<T>(stage:string,run:(repair?:StageRepair)=>Promise<T>):Promise<T>{
 try{return await run();}catch(error){
  if(!(error instanceof ProcessingError)||!repairable.has(error.code))throw error;
  const issues=(e:ProcessingError)=>e.diagnostic&&'issues' in e.diagnostic?e.diagnostic.issues:e.diagnostic&&'field' in e.diagnostic?[{code:e.code,path:e.diagnostic.field.split('.')}]:[];
  const repair:StageRepair={stage,code:error.code,issues:issues(error),instructions:'One final bounded repair. Correct only this stage using the original source and existing validated evidence. Never invent or randomly assign evidence IDs. Every sentence needs supporting existing factIds; source-unit IDs are not factIds. Remove or faithfully rephrase unsupported wording without dropping material facts. All original schema, evidence, attribution, coverage and semantic validators run again. For UNCOVERED_SOURCE_SPAN, only extraction can repair: include the indicated original source span in a complete verbatim assertion; never fabricate facts or discard it. For speaker errors use only the governing explicit source speaker, never a later mention. Do not reconsider already completed relevance/content selection.'};
  try{return await run(repair);}catch(remaining){
   if(remaining instanceof ProcessingError&&repairable.has(remaining.code))throw new ProcessingError('AI_SCHEMA_REPAIR_FAILED',false,{stage,causeCode:remaining.code,issues:issues(remaining)});
   throw remaining;
  }
 }
}
