import {z} from 'zod';
import {ProcessingError} from './contracts';
import {directArticleSchema} from './direct-generation-contract';

export const intakeSchema=z.object({iranRelated:z.boolean(),rationale:z.string().min(1).max(4000)}).strict();
export const intakeInstructions=`Decide ONLY whether the complete source text establishes a genuine material connection to Iran. Accept any topic when this substantive connection is established. Source/channel identity, branding, metadata, footer or hashtags alone are insufficient. Do not invent a connection or infer unseen media. Return iranRelated=false only when the source does not establish a material connection. Do not extract facts, generate evidence offsets, assess newsworthiness, classify topics or generate an article.`;
export type PreGenerationAudit={usableSourceContent:boolean;iranRelated:boolean|null;generationRequired:boolean;generationReached:boolean;articleReturned:boolean;causeCode?:string};
export type GenerationIntake={content:string};
export type GeneratedInput={audit:PreGenerationAudit;article?:z.infer<typeof directArticleSchema>};
export type GenerationObserver=(event:PreGenerationAudit)=>Promise<void>;
export const usableSourceContent=(text:string)=>/[\p{L}\p{N}]/u.test(text);
/** Infrastructure failures keep their real code/retry policy. The audit exposes
 * the missing generation boundary separately, never as an editorial verdict. */
export async function generateFirst(source:string,assess:()=>Promise<unknown>,generate:()=>Promise<unknown>,observe:GenerationObserver=async()=>{}):Promise<GeneratedInput>{
 const audit:PreGenerationAudit={usableSourceContent:usableSourceContent(source),iranRelated:null,generationRequired:false,generationReached:false,articleReturned:false};
 await observe({...audit});
 if(!audit.usableSourceContent)throw new ProcessingError('SOURCE_TEXT_REQUIRED');
 const intake=intakeSchema.parse(await assess());
 audit.iranRelated=intake.iranRelated;audit.generationRequired=intake.iranRelated;
 await observe({...audit});
 if(!intake.iranRelated)return {audit};
 try{
  // Nothing capable of inspecting extraction or evidence runs between these lines.
  audit.generationReached=true;await observe({...audit});
  const article=directArticleSchema.parse(await generate());
  audit.articleReturned=true;await observe({...audit});
  return {audit,article};
 }catch(error){
  await observe({...audit,causeCode:error instanceof ProcessingError?error.code:'GENERATION_RESPONSE_INVALID'});
  throw error;
 }
}
export function assertGenerationRequired(value:GeneratedInput){
 if(value.audit.usableSourceContent&&value.audit.iranRelated&&(!value.audit.generationRequired||!value.audit.generationReached||!value.article))throw new ProcessingError('IRAN_RELATED_STORY_DID_NOT_REACH_GENERATION',false,{stage:'PRE_GENERATION',issues:[{code:'APPLICATION_INVARIANT',path:['generationRequired']}],output:value.audit});
}
