import {z} from 'zod';
import {ProcessingError} from '../processing/contracts';
export const autoPolicySchema=z.object({version:z.literal('telegram-auto-v1'),id:z.uuid(),state:z.enum(['CANARY','ACTIVE','CLOSED']),destination:z.string().regex(/^-[1-9]\d*$/),notBefore:z.iso.datetime(),sourceIds:z.array(z.string().min(1)),sourceNotBefore:z.record(z.string(),z.iso.datetime()).optional(),canaryCandidateId:z.string().nullable(),authorizedBy:z.string().min(1),reason:z.string().optional()}).strict();
export type AutoPolicy=z.infer<typeof autoPolicySchema>;
export function requireAutoPolicy(raw:unknown,env:Record<string,string|undefined>){
 const p=autoPolicySchema.safeParse(raw);
 if(!p.success||p.data.state==='CLOSED'||env.AUTO_PUBLISH!=='true'||env.SHADOW_MODE!=='false'||env.REQUIRE_APPROVAL!=='true'||env.TELEGRAM_PUBLISH_ENABLED!=='true'||p.data.destination!==env.TELEGRAM_CHAT_ID)throw new ProcessingError('AUTOMATIC_DELIVERY_DISABLED');
 if(p.data.state==='CANARY'&&!p.data.canaryCandidateId)throw new ProcessingError('CANARY_CANDIDATE_REQUIRED');
 return p.data;
}
