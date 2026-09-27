import {ProcessingError} from './contracts';
/** Fixed-size wire schema, independent of candidate count. Positional types,
 * alias membership and snapshot equality remain authoritative local checks.
 * Avoid heterogeneous prefixItems in the Gemini compatibility projection. */
export function matchingWireSchema(schema:unknown){
 const copy=structuredClone(schema) as {properties:{matches:{items:unknown}}};
 copy.properties.matches.items={type:'array',items:{anyOf:[{type:'string'},{type:'boolean'}]}};
 return copy;
}
export function matchingSerialization(_schema:unknown){
 void _schema;
 return 'Response serialization only: matches contains fixed five-element rows [alias, relation, materialUpdate, conflict, rationale]. Return the exact snapshot and assessmentComplete=true. S means SAME_OCCURRENCE and U means UNCERTAIN. Omit negative rows only after assessing every candidate. Do not return a final decision. No duplicate or unknown aliases.';
}
export function decodeMatchingReceipt(content:string,_schema:unknown):string{
 void _schema;
 try{JSON.parse(content);}catch{throw new ProcessingError('INVALID_COMPARISON_SCHEMA');}
 // No repair, inference, negative-row synthesis or legacy receipt fallback.
 // The canonical local schema validates the complete receipt after decoding.
 return content;
}
