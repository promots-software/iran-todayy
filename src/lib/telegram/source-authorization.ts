import {isDeepStrictEqual} from 'node:util';
import type {Prisma} from '@prisma/client';
import {autoPolicySchema,type AutoPolicy} from './auto-policy';

/** Caller holds the editorial publication lock BEFORE changing any source row. */
export async function syncAutomaticSources(tx:Prisma.TransactionClient,actor:string){
 const settings=await tx.appSettings.findUnique({where:{id:1}});
 // Source management never creates a global delivery authorization.
 if(!settings?.telegramAutoPolicy)return null;
 const policy=autoPolicySchema.parse(settings.telegramAutoPolicy);
 const sources=await tx.source.findMany({where:{platform:'TELEGRAM',enabled:true,deletedAt:null},select:{id:true},orderBy:{id:'asc'}});
 const now=(await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now.toISOString();
 const next=reconcileSourceAuthorization(policy,sources.map(s=>s.id),now);
 if(isDeepStrictEqual(policy,next))return next;
 await tx.appSettings.update({where:{id:1},data:{telegramAutoPolicy:next}});
 await tx.auditLog.create({data:{actor,action:'AUTOMATIC_SOURCE_AUTHORIZATION_SYNCED',entityType:'AppSettings',entityId:'1',message:'مزامنة صلاحية المصادر المفعلة؛ المصادر المضافة مؤهلة للأخبار الجديدة فقط',metadata:{policyId:policy.id,previousSourceIds:policy.sourceIds,sourceIds:next.sourceIds,sourceNotBefore:next.sourceNotBefore!,effectiveAt:now}}});
 return next;
}

export function reconcileSourceAuthorization(policy:AutoPolicy,enabledTelegramIds:string[],now:string):AutoPolicy{
 const sourceIds=[...new Set(enabledTelegramIds)].sort();
 const sourceNotBefore=Object.fromEntries(sourceIds.map(id=>[id,policy.sourceIds.includes(id)?policy.sourceNotBefore?.[id]??policy.notBefore:now]));
 return autoPolicySchema.parse({...policy,sourceIds,sourceNotBefore});
}
