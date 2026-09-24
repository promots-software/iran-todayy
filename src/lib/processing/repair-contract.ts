import {z} from 'zod';
export type RepairPath=(string|number)[];
export const repairDiagnosticSchema=z.object({code:z.string(),path:z.array(z.union([z.string(),z.number()])),current:z.unknown(),expected:z.string(),cause:z.string(),sourceSpans:z.array(z.object({start:z.number().int(),end:z.number().int(),text:z.string()})),factIds:z.array(z.string()),speakerIds:z.array(z.string()),occurrenceIds:z.array(z.string()),allowedPaths:z.array(z.array(z.union([z.string(),z.number()]))),immutableText:z.array(z.string()).optional()});
export type RepairDiagnostic=z.infer<typeof repairDiagnosticSchema>;
export const repairTraceSchema=z.object({cycle:z.number().int().min(0).max(2),code:z.string().nullable(),issues:z.array(z.object({code:z.string(),path:z.array(z.union([z.string(),z.number()]))})),candidateHash:z.string().nullable(),changedPaths:z.array(z.array(z.union([z.string(),z.number()]))),decision:z.string(),diagnostics:z.array(repairDiagnosticSchema),resolved:z.array(z.string()),remaining:z.array(z.string()),introduced:z.array(z.string())});
export type RepairTrace=z.infer<typeof repairTraceSchema>;
