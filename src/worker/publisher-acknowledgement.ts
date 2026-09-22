import type {PrismaClient} from '@prisma/client';
import {autoPolicySchema} from '../lib/telegram/auto-policy';
/** Acknowledge exactly what this process observed, before attempting delivery. */
export async function acknowledgePublisher(db:PrismaClient,env:Record<string,string|undefined>,startedAt:Date,status:string,lastError:string|null,intervalMs:number,previousKey:string|null){
 const settings=await db.appSettings.findUniqueOrThrow({where:{id:1},select:{telegramAutoPolicy:true}});
 const parsed=autoPolicySchema.safeParse(settings.telegramAutoPolicy);
 const key=parsed.success?`${parsed.data.id}:${parsed.data.state}`:'';
 const metadata={status,autoPublish:env.AUTO_PUBLISH==='true',shadowMode:env.SHADOW_MODE!=='false',requireApproval:env.REQUIRE_APPROVAL!=='false',externalPublishingEnabled:env.TELEGRAM_PUBLISH_ENABLED==='true',destination:env.TELEGRAM_CHAT_ID??null,policyId:parsed.success?parsed.data.id:null,policyState:parsed.success?parsed.data.state:null,commit:env.RAILWAY_GIT_COMMIT_SHA??null};
 const data={state:lastError?'ERROR' as const:'IDLE' as const,phase:'PUBLISHING',startedAt,lastSeenAt:new Date(),lastError,intervalMs,metadata};
 await db.workerHeartbeat.upsert({where:{id:'telegram-publisher-worker'},create:{id:'telegram-publisher-worker',...data},update:data});
 if(key&&key!==previousKey)await db.auditLog.upsert({where:{id:`publisher-ack:${key}`},update:{},create:{id:`publisher-ack:${key}`,actor:'automatic-telegram-worker',action:'PUBLISHER_POLICY_ACKNOWLEDGED',entityType:'AppSettings',entityId:'1',message:'Publisher observed requested policy before delivery',metadata:{policyId:metadata.policyId,policyState:metadata.policyState,observedAt:new Date().toISOString()}}});
 return key;
}
