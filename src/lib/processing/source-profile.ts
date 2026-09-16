import type { PrismaClient } from "@prisma/client";
import { sourceProfileSchema } from "./contracts";
import { json } from "./engine";
export async function saveSourceProfile(client:PrismaClient,id:string,input:unknown,actor:string) {
  const profile=sourceProfileSchema.parse(input);
  return client.$transaction(async tx=>{
    const source=await tx.source.findUniqueOrThrow({where:{id}});
    if(source.deletedAt)throw new Error("SOURCE_NOT_FOUND");
    await tx.source.update({where:{id},data:{editorialProfile:json(profile)}});
    await tx.auditLog.create({data:{actor,action:"SOURCE_PROFILE_UPDATED",entityType:"Source",entityId:id,message:"توثيق تصنيف المصدر التحريري",metadata:json({previous:source.editorialProfile,next:profile})}});
  });
}
