import {stableJson} from './structural-integrity';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ProcessingError} from './contracts';
import {resolveContextEvidence} from './groq-validation';
export const evidenceCorrectionInstructions='Identify ONLY the originally intended exact occurrence using the immutable source and fact association, or return UNRESOLVED. Do not prefer the first, nearest or token-bounded occurrence. No rewritten facts, excerpts, context or article. Exact substring identity alone does not establish semantic correctness.';
export const evidenceCorrectionSchema=z.object({corrections:z.array(z.object({fieldId:z.string(),status:z.enum(['RESOLVED','UNRESOLVED']),startOffset:z.number().int().nonnegative().nullable(),endOffset:z.number().int().positive().nullable()}).strict()).min(1)}).strict();
type Slot={fieldId:string;path:string[];excerpt:string;context:string;originalOffsets:unknown;code:string;candidates:{startOffset:number;endOffset:number}[]};
const occurrences=(s:string,t:string)=>{const out:number[]=[];if(t)for(let at=s.indexOf(t);at>=0;at=s.indexOf(t,at+1))out.push(at);return out;};
export function evidenceMetadataPlan(source:string,raw:unknown,schema:z.ZodType,knownSemanticFailure=false){
 schema.parse(raw);if(knownSemanticFailure)throw new ProcessingError('EVIDENCE_METADATA_INELIGIBLE');
 const slots:Slot[]=[];const frozen=JSON.parse(stableJson(raw));const identity=createHash('sha256').update(stableJson([source,frozen])).digest('hex');
 function visit(v:unknown,path:string[]){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>visit(x,[...path,String(i)]));return;}const o=v as Record<string,unknown>;
 if(typeof o.excerpt==='string'){try{resolveContextEvidence(structuredClone(o),source);return;}catch(e){if(!(e instanceof ProcessingError)||e.code!=='AMBIGUOUS_EVIDENCE_CONTEXT')throw e;
 const excerpt=o.excerpt,context=o.context;if(!excerpt||typeof context!=='string'||!context)throw new ProcessingError('EVIDENCE_METADATA_INELIGIBLE');
 const contexts=occurrences(source,context);const candidates=occurrences(source,excerpt).filter(at=>contexts.some(base=>base<=at&&at+excerpt.length<=base+context.length)).map(startOffset=>({startOffset,endOffset:startOffset+excerpt.length}));
 if(!candidates.length)throw new ProcessingError('EVIDENCE_METADATA_INELIGIBLE');slots.push({fieldId:identity+':'+path.join('.'),path,excerpt,context,originalOffsets:{startOffset:o.startOffset??null,endOffset:o.endOffset??null},code:e.code,candidates});return;}}
 for(const [k,x] of Object.entries(o))visit(x,[...path,k]);}
 visit(frozen,[]);return {version:'evidence-metadata-v1',identity,source,extraction:frozen,slots};
}
export function graftEvidenceMetadata(plan:ReturnType<typeof evidenceMetadataPlan>,response:unknown){
 const parsed=evidenceCorrectionSchema.parse(response);const ids=parsed.corrections.map(c=>c.fieldId);if(ids.length!==plan.slots.length||new Set(ids).size!==ids.length||ids.some(id=>!plan.slots.some(s=>s.fieldId===id)))throw new ProcessingError('EVIDENCE_METADATA_IDS_INVALID');
 const result=structuredClone(plan.extraction);const masked=structuredClone(plan.extraction);
 const get=(root:unknown,path:string[])=>path.reduce((v,k)=>(v as Record<string,unknown>)[k],root) as Record<string,unknown>;
 for(const c of parsed.corrections){const slot=plan.slots.find(s=>s.fieldId===c.fieldId)!;if(c.status!=='RESOLVED')throw new ProcessingError('EVIDENCE_METADATA_UNRESOLVED');if(!slot.candidates.some(x=>x.startOffset===c.startOffset&&x.endOffset===c.endOffset))throw new ProcessingError('EVIDENCE_METADATA_RANGE_INVALID');const target=get(result,slot.path);target.startOffset=c.startOffset;target.endOffset=c.endOffset;}
 const compare=structuredClone(result);for(const s of plan.slots)for(const k of ['startOffset','endOffset']){delete get(compare,s.path)[k];delete get(masked,s.path)[k];}if(stableJson(compare)!==stableJson(masked))throw new ProcessingError('EVIDENCE_METADATA_FROZEN_CHANGED');return result;
}
/** No recursive correction. Caller always reruns the complete original validator. */
export async function correctEvidenceMetadata<T>(source:string,raw:unknown,schema:z.ZodType,validate:(raw:unknown)=>T,request:(plan:ReturnType<typeof evidenceMetadataPlan>)=>Promise<unknown>):Promise<T>{
 try{return validate(raw);}catch(error){if(!(error instanceof ProcessingError)||error.code!=='AMBIGUOUS_EVIDENCE_CONTEXT')throw error;const plan=evidenceMetadataPlan(source,raw,schema);if(!plan.slots.length)throw error;return validate(graftEvidenceMetadata(plan,await request(plan)));}
}
