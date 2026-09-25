import {propositionReceiptSchema} from './proposition-receipt';
import {eventIdentitySchema} from './event-identity';
import {z} from 'zod';
import {directPublicationReviewSchema} from './direct-publication-contract';

const text=z.string().min(1).max(20000);
export const directArticleSchema=z.object({title:text,body:z.string().max(20000),diagnostics:z.array(z.string().min(1).max(300)).max(100)}).strict();
/** Completion/source binding, NOT an assertion of independent semantic verification. */
const legacyGeneration=z.object({version:z.literal('direct-generation-v2'),sourceHash:text,articleHash:text,eventHash:text,editorialContractHash:text,article:directArticleSchema,localDiagnostics:z.array(text).max(100),semanticVerification:z.literal('DIAGNOSTIC_ONLY')}).strict();
export const directMatchingReviewSchema=z.array(z.object({id:text,decision:z.object({relation:z.enum(['SAME','DIFFERENT','UNCERTAIN']),rationale:text,newFactIds:z.array(text),conflictingFactIds:z.array(text),identity:eventIdentitySchema.optional()}).strict()}).strict()).max(1000);
export const reviewedDirectGenerationSchema=legacyGeneration.extend({version:z.literal('direct-generation-v3'),propositionReview:propositionReceiptSchema.optional(),semanticVerification:z.literal('INDEPENDENT'),review:directPublicationReviewSchema,reviewHash:text,matchingReview:directMatchingReviewSchema,matchingReviewHash:text}).strict();
// Historical v2 records stay readable; the live provider creates v3 only.
export const directGenerationSchema=z.discriminatedUnion('version',[legacyGeneration,reviewedDirectGenerationSchema]);
