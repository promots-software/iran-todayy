import {z} from 'zod';
const text=z.string().min(1).max(20000);
export const renderingChecks=['scope','entitiesAndRelationships','namesAndTitles','numbers','attribution','negationAndModality','literalQuotes'] as const;
export const renderingEntrySchema=z.object({id:text,arabic:text}).strict();
export const renderingReviewSchema=z.object({id:text,verdict:z.enum(['SUPPORTED','UNSUPPORTED','UNCERTAIN']),checks:z.object(Object.fromEntries(renderingChecks.map(k=>[k,z.boolean()])) as Record<typeof renderingChecks[number],z.ZodBoolean>).strict(),issues:z.array(text)}).strict();
export const renderingReceiptSchema=z.object({version:z.literal('evidence-arabic-v1'),sourceHash:text,entries:z.array(renderingEntrySchema),review:z.array(renderingReviewSchema)}).strict();
export type RenderingReceipt=z.infer<typeof renderingReceiptSchema>;
