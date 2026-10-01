import {z} from 'zod';
/** Strict allowlist: never store raw exception messages, URLs or headers. */
export const deliveryDiagnosticsSchema=z.object({
 retryAfterSeconds:z.number().int().min(1).max(86400).optional(),dispatchBegan:z.boolean(),phase:z.enum(['PRE_DISPATCH','AWAITING_RESPONSE','PARSING_RESPONSE','RESPONSE_VALIDATION']),
 httpStatus:z.number().int().min(100).max(599).nullable(),parsingBegan:z.boolean(),parsingCompleted:z.boolean(),
 errorCategory:z.enum(['TIMEOUT','ABORTED','RESPONSE_PARSE_FAILED','TRANSPORT_EXCEPTION','UNEXPECTED_RESPONSE','TELEGRAM_REJECTED']).nullable(),
}).strict();
export function safeDeliveryDiagnostics(raw:Record<string,unknown>){
 return deliveryDiagnosticsSchema.parse(Object.fromEntries(Object.keys(deliveryDiagnosticsSchema.shape).map(k=>[k,raw[k]])));
}
