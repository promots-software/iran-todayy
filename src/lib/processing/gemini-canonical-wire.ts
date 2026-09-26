import {z} from 'zod';
import {canonicalCheckSchema} from './canonical-flow';
import {ProcessingError} from './contracts';

const ids=Array.from({length:40},(_,i)=>String(i+1));
const rowsSchema=z.object({sections:z.array(canonicalCheckSchema.shape.sections.shape['1'].extend({sectionId:z.enum(ids as [string,...string[]])})).length(40)}).strict();

/** Gemini rejects the expanded forty-key receipt schema. Serialize identical
 * section information as rows; the domain receipt and its validation stay intact. */
export function canonicalGeminiWireSchema(schema:unknown):unknown {
 const copy=structuredClone(schema) as {properties:{sections:{properties:Record<string,unknown>}}};
 const sections=copy.properties.sections;
 if(Object.keys(sections.properties).join(',')!==ids.join(','))throw new ProcessingError('CANONICAL_CHECK_INVALID');
 const row=structuredClone(sections.properties['1']) as {properties:Record<string,unknown>;required:string[]};
 if(ids.some(id=>JSON.stringify(sections.properties[id])!==JSON.stringify(sections.properties['1'])))throw new ProcessingError('CANONICAL_CHECK_INVALID');
 row.properties.sectionId={type:'string',enum:ids};row.required=['sectionId',...row.required];
 (copy.properties as Record<string,unknown>).sections={type:'array',items:row};
 return copy;
}

export const canonicalGeminiSerialization='WIRE FORMAT ONLY: serialize sections as exactly 40 rows, one per sectionId "1" through "40". Each row retains status and all defect/correction/sourceQuote/articleQuote fields. No missing, duplicate or additional section IDs. This changes serialization only, not any editorial instruction.';

export function decodeCanonicalGeminiReceipt(content:string):string {
 let raw:unknown;try{raw=JSON.parse(content);}catch{throw new ProcessingError('CANONICAL_CHECK_INVALID');}
 const parsed=rowsSchema.safeParse(raw);
 if(!parsed.success||new Set(parsed.data.sections.map(r=>r.sectionId)).size!==40)throw new ProcessingError('CANONICAL_CHECK_INVALID');
 const sections=Object.fromEntries(parsed.data.sections.map(({sectionId,...section})=>[sectionId,section]));
 return JSON.stringify(canonicalCheckSchema.parse({sections}));
}
