import {z} from 'zod';

const text=z.string().min(1).max(20000);
export const directArticleSchema=z.object({title:text,body:z.string().max(20000),diagnostics:z.array(z.string().min(1).max(300)).max(100)}).strict();
/** Completion/source binding, NOT an assertion of independent semantic verification. */
export const directGenerationSchema=z.object({version:z.literal('direct-generation-v2'),sourceHash:text,articleHash:text,eventHash:text,editorialContractHash:text,article:directArticleSchema,localDiagnostics:z.array(text).max(100),semanticVerification:z.literal('DIAGNOSTIC_ONLY')}).strict();
