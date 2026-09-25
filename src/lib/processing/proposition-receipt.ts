import {z} from 'zod';
export const propositionReceiptSchema=z.object({version:z.literal('proposition-support-v4.4'),identity:z.string().regex(/^[a-f0-9]{64}$/),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),publicationHash:z.string().regex(/^[a-f0-9]{64}$/),catalogDigest:z.string().regex(/^[a-f0-9]{64}$/),verdict:z.literal('SUPPORTED')}).strict();
