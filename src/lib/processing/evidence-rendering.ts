import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ProcessingError} from './contracts';
import {validateNoCountryAddition} from './classification-grounding';
import {requireArabic} from './groq-validation';
import {renderingChecks,renderingEntrySchema,renderingReceiptSchema,type RenderingReceipt} from './rendering-contract';
import {persianMonths,validateMonthRendering} from './newsroom-format';

export type RenderingReference={id:string;role:string;evidence:{excerpt:string;start:number;end:number;sourcePostId?:string}};
const sourceHash=(source:string)=>createHash('sha256').update(source).digest('hex');
const exactIds=(actual:string[],expected:string[])=>actual.length===expected.length&&new Set(actual).size===expected.length&&expected.every(id=>actual.includes(id));
const digits=(text:string)=>(text.replace(/[٠-٩۰-۹]/gu,c=>String('٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).match(/\d+(?:[.,]\d+)*/g)??[]).sort();
function validateEntry(ref:RenderingReference,arabic:string){
 requireArabic(arabic);validateNoCountryAddition(arabic,[ref.evidence.excerpt]);
 validateMonthRendering(ref.evidence.excerpt,arabic);
 if(JSON.stringify(digits(arabic))!==JSON.stringify(digits(ref.evidence.excerpt)))throw new ProcessingError('ARABIC_RENDERING_NUMBER_MISMATCH');
 if(!/[«»“”"]/.test(ref.evidence.excerpt)&&/[«»“”"]/.test(arabic))throw new ProcessingError('ARABIC_RENDERING_QUOTE_ADDED');
}

export function renderingSchemaFor(refs:RenderingReference[]){
 const ids=refs.map(r=>r.id) as [string,...string[]];
 return z.object({entries:z.array(renderingEntrySchema.extend({id:z.enum(ids)})).length(ids.length)}).strict();
}
export function renderingReviewSchemaFor(refs:RenderingReference[]){
 const ids=refs.map(r=>r.id) as [string,...string[]];
 return z.object({review:z.array(z.object({id:z.enum(ids),verdict:z.enum(['SUPPORTED','UNSUPPORTED','UNCERTAIN']),
  checks:z.object(Object.fromEntries(renderingChecks.map(k=>[k,z.boolean()])) as Record<typeof renderingChecks[number],z.ZodBoolean>).strict(),issues:z.array(z.string().min(1).max(20000))}).strict()).length(ids.length)}).strict();
}
export const renderingInstructions='Render the grounded meaning of each immutable source reference in concise, natural professional Modern Standard Arabic; avoid mechanical source syntax. Return only id and arabic. Preserve the exact factual scope, subject, predicate, negation, modality, quantities, names, titles, attribution, pronouns, possessives and unresolved relationships. Keep every number as digits with the same value. Do not omit material meaning, combine references, add geography, nationality, identity, role, affiliation, ownership, motives, background facts or quotation marks. IDs and evidence are immutable. Every supplied ID must appear exactly once. Persian month names use these client labels: '+JSON.stringify(persianMonths)+'. This naming convention is NOT a Gregorian date conversion. Preserve numeric dates in their original calendar and explicitly label them بالتقويم الإيراني; never invent Gregorian dates.';
export const renderingReviewInstructions='Independently compare each Arabic rendering only with its matching immutable source excerpt. Return every ID exactly once. SUPPORTED requires all checks true and no issues: identical factual scope; no added entity or relationship; names/titles and numbers preserved; attribution, negation and modality preserved; no fabricated literal quote. Use UNSUPPORTED for a contradiction/addition/omission and UNCERTAIN whenever semantic equivalence cannot be established. Do not repair text, translate, use external facts or infer from the source account.';

export function renderingInput(refs:RenderingReference[]){return {references:refs.map(r=>({id:r.id,role:r.role,source:r.evidence.excerpt}))};}
export function renderingReviewInput(refs:RenderingReference[],rendered:unknown){return {...renderingInput(refs),rendered};}
export function validateRendering(source:string,refs:RenderingReference[],rawRendered:unknown,rawReview:unknown):RenderingReceipt{
 const rendered=renderingSchemaFor(refs).safeParse(rawRendered),reviewed=renderingReviewSchemaFor(refs).safeParse(rawReview);
 if(!rendered.success||!reviewed.success)throw new ProcessingError('INVALID_ARABIC_RENDERING_SCHEMA');
 if(!exactIds(rendered.data.entries.map(e=>e.id),refs.map(r=>r.id))||!exactIds(reviewed.data.review.map(e=>e.id),refs.map(r=>r.id)))throw new ProcessingError('ARABIC_RENDERING_ID_MISMATCH');
 const byId=new Map(refs.map(r=>[r.id,r]));
 for(const entry of rendered.data.entries){
  validateEntry(byId.get(entry.id)!,entry.arabic);
 }
 const translationsBySpan=new Map<string,string>();
 for(const entry of rendered.data.entries){const ref=byId.get(entry.id)!,span=`${ref.evidence.start}:${ref.evidence.end}`,prior=translationsBySpan.get(span);if(prior&&prior!==entry.arabic)throw new ProcessingError('ARABIC_RENDERING_INCONSISTENT');translationsBySpan.set(span,entry.arabic);}
 for(const review of reviewed.data.review)if(review.verdict!=='SUPPORTED'||renderingChecks.some(k=>!review.checks[k])||review.issues.length)throw new ProcessingError('UNVALIDATED_ARABIC_RENDERING');
 return renderingReceiptSchema.parse({version:'evidence-arabic-v1',sourceHash:sourceHash(source),entries:rendered.data.entries,review:reviewed.data.review});
}
export function resolveRendering(source:string,refs:RenderingReference[],receipt:unknown){
 const parsed=renderingReceiptSchema.safeParse(receipt);
 if(!parsed.success||parsed.data.sourceHash!==sourceHash(source))throw new ProcessingError('VALIDATED_ARABIC_RENDERING_REQUIRED');
 const entries=new Map(parsed.data.entries.map(e=>[e.id,e.arabic])),reviews=new Map(parsed.data.review.map(e=>[e.id,e]));
 for(const ref of refs){const arabic=entries.get(ref.id),review=reviews.get(ref.id);if(!arabic||!review)throw new ProcessingError('VALIDATED_ARABIC_RENDERING_REQUIRED');validateEntry(ref,arabic);if(review.verdict!=='SUPPORTED'||renderingChecks.some(k=>!review.checks[k])||review.issues.length)throw new ProcessingError('UNVALIDATED_ARABIC_RENDERING');}
 return entries;
}
