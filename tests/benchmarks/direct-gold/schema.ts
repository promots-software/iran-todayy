import {z} from 'zod';
const texts=z.array(z.string().min(1));
export const goldCaseSchema=z.object({
 id:z.string().regex(/^D\d{2,4}$/),name:z.string(),language:z.enum(['ar','fa','en']),category:z.enum(['A','B','C','D','E','F','G','H','I','J']),tags:texts,sourceText:z.string().min(1),sourceType:z.enum(['SYNTHETIC','ADAPTED','PAIRED']),
 expectedDisposition:z.enum(['READY_TO_PUBLISH','NEEDS_REVIEW','FILTERED','DUPLICATE']),
 materialFacts:z.array(z.object({id:z.string(),sourceExcerpt:z.string().min(1),meaning:z.string().min(1),predicates:z.array(z.object({anyOf:texts.min(1)}).strict()).min(1)}).strict()).min(1),
 requiredAttributions:texts,requiredNumbers:texts,requiredDates:texts,requiredLocations:texts,requiredEntities:texts,requiredQuotes:texts,requiredModalities:texts,requiredConditions:texts,forbiddenAdditions:texts,expectedCoverage:texts,
 styleCharacteristics:texts,allowedTransformations:texts,forbiddenTransformations:texts,duplicateGroup:z.string().nullable(),relation:z.object({kind:z.enum(['NEW_EVENT','DUPLICATE','MATERIAL_UPDATE','UNCERTAIN_MATCH']),previousCaseId:z.string().nullable()}).strict(),notes:z.string(),goldReviewStatus:z.literal('ENGINEERING_DRAFT_NOT_HUMAN_SIGNED_OFF'),
 replay:z.object({actors:texts,action:z.string(),object:z.string(),location:z.string().nullable().optional(),speakers:texts,arabicFacts:texts,anchorArabic:z.record(z.string(),z.string()),publication:z.unknown().nullable(),seriousClaim:z.boolean(),flagged:z.boolean(),kind:z.string().nullable(),comparison:z.unknown().nullable()}).strict(),
}).strict();
export type GoldCase=z.infer<typeof goldCaseSchema>;
export const datasetSchema=z.object({version:z.literal('direct-gold-v1'),authorship:z.string(),policyReferences:texts,styleEvidence:z.array(z.object({artifact:z.string(),messageIds:z.array(z.number()),use:z.string()}).strict()),trueHistoricalSourceGoldPairs:z.number(),cases:z.array(goldCaseSchema)}).strict();
export function validateDataset(raw:unknown,expectedSize=50){
 const d=datasetSchema.parse(raw);if(d.cases.length!==expectedSize)throw Error('GOLD_CASE_COUNT');
 const seen=new Set<string>();for(const c of d.cases){
  if(seen.has(c.id)||c.relation.previousCaseId&&!seen.has(c.relation.previousCaseId))throw Error('GOLD_ID_OR_RELATION');seen.add(c.id);
  if(new Set(c.materialFacts.map(f=>f.id)).size!==c.materialFacts.length||c.materialFacts.some(f=>!c.sourceText.includes(f.sourceExcerpt))||JSON.stringify(c.expectedCoverage)!==JSON.stringify(c.materialFacts.map(f=>f.id)))throw Error('GOLD_EVIDENCE_COVERAGE');
 }
 return d;
}
