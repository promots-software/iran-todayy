import {z} from 'zod';
import {canonicalCheckSchema,validateCanonicalCheck,type CanonicalCheck} from './canonical-flow';
import {ProcessingError} from './contracts';
import {EDITORIAL_CONTRACT_SHA256} from './editorial-contract';

const ids=Array.from({length:40},(_,i)=>String(i+1));
const defects=canonicalCheckSchema.shape.sections.shape['1'].shape.defects;
export const compactCheckerReceiptSchema=z.object({
 contract:z.literal(EDITORIAL_CONTRACT_SHA256),
 statuses:z.array(z.enum(['P','F','N'])).length(40),
 diagnoses:z.array(z.object({sectionId:z.enum(ids as [string,...string[]]),defects}).strict()).max(40)
}).strict();
/** Full contract and section rules stay unchanged; order is section 1..40. */
export function compactCanonicalGeminiWireSchema(schema:unknown):unknown {
 const original=structuredClone(schema) as {properties:{sections:{properties:Record<string,{properties:{defects:unknown}}>}}};
 const sections=original.properties.sections.properties;
 if(Object.keys(sections).join(',')!==ids.join(',')||ids.some(id=>JSON.stringify(sections[id])!==JSON.stringify(sections['1'])))throw new ProcessingError('CANONICAL_CHECK_INVALID');
 return {type:'object',additionalProperties:false,properties:{
  contract:{type:'string',enum:[EDITORIAL_CONTRACT_SHA256]},
  statuses:{type:'array',items:{type:'string',enum:['P','F','N']}},
  diagnoses:{type:'array',items:{type:'object',additionalProperties:false,properties:{sectionId:{type:'string',enum:ids},defects:sections['1'].properties.defects},required:['sectionId','defects']}}
 },required:['contract','statuses','diagnoses']};
}
export const canonicalGeminiSerialization=`WIRE FORMAT ONLY (canonical-status-v1): echo contract ${EDITORIAL_CONTRACT_SHA256}. statuses contains exactly 40 explicit codes in section order 1 through 40: P=PASS, F=FAIL, N=NOT_APPLICABLE. Evaluate every section; never omit a status or infer PASS. Section 40 cannot be N. diagnoses contains exactly one entry per F section, with sectionId and all original defect/correction/sourceQuote/articleQuote fields. No diagnosis for P/N, unknown/duplicate mapping or empty F diagnosis. Reconstructing this transport must preserve all forty decisions and every failed-section diagnosis. Editorial instructions, complete contract, repair scope and quote rules are unchanged.`;
export function decodeCompactCanonicalGeminiReceipt(content:string):string {
 let raw:unknown;try{raw=JSON.parse(content);}catch{throw new ProcessingError('CANONICAL_CHECK_INVALID');}
 const parsed=compactCheckerReceiptSchema.safeParse(raw);
 if(!parsed.success)throw new ProcessingError('CANONICAL_CHECK_INVALID');
 const {statuses,diagnoses}=parsed.data;
 const bySection=new Map<string,z.infer<typeof defects>>();
 for(const diagnosis of diagnoses){
  const i=Number(diagnosis.sectionId)-1;
  if(bySection.has(diagnosis.sectionId)||statuses[i]!=='F'||!diagnosis.defects.length)throw new ProcessingError('CANONICAL_CHECK_INVALID');
  bySection.set(diagnosis.sectionId,diagnosis.defects);
 }
 const sections=Object.fromEntries(ids.map((id,i)=>{
  if(statuses[i]==='F'&&!bySection.has(id))throw new ProcessingError('CANONICAL_CHECK_INVALID');
  return [id,{status:statuses[i]==='P'?'PASS':statuses[i]==='F'?'FAIL':'NOT_APPLICABLE',defects:bySection.get(id)??[]}];
 }));
 return JSON.stringify(validateCanonicalCheck({sections}));
}
/** Offline encoder for historical round-trip verification; never called to
 * complete a missing/partial provider receipt. */
export function encodeCompactCanonicalReceipt(check:CanonicalCheck){
 const valid=validateCanonicalCheck(check);
 return {contract:EDITORIAL_CONTRACT_SHA256,statuses:ids.map(id=>valid.sections[id].status==='PASS'?'P':valid.sections[id].status==='FAIL'?'F':'N'),
  diagnoses:ids.filter(id=>valid.sections[id].status==='FAIL').map(sectionId=>({sectionId,defects:structuredClone(valid.sections[sectionId].defects)}))};
}
/** Legacy row decoder retained for offline historical/experimental callers.
 * The live Gemini adapter exclusively calls the strict compact decoder above. */
export function decodeCanonicalGeminiReceipt(content:string):string {
 const rowsSchema=z.object({sections:z.array(canonicalCheckSchema.shape.sections.shape['1'].extend({sectionId:z.enum(ids as [string,...string[]])})).length(40)}).strict();
 let raw:unknown;try{raw=JSON.parse(content);}catch{throw new ProcessingError('CANONICAL_CHECK_INVALID');}
 const parsed=rowsSchema.safeParse(raw);
 if(!parsed.success||new Set(parsed.data.sections.map(r=>r.sectionId)).size!==40)throw new ProcessingError('CANONICAL_CHECK_INVALID');
 return JSON.stringify(canonicalCheckSchema.parse({sections:Object.fromEntries(parsed.data.sections.map(({sectionId,...section})=>[sectionId,section]))}));
}

/** Legacy schema projection for offline experimental callers only. */
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
