/** Explicit local bootstrap only. Not invoked by builds, migrations or workers. */
import {readFile,unlink} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
const file=new URL('../.test-tools/super-admin-setup/credential.json',import.meta.url);
async function main(){
 const prepared=JSON.parse(await readFile(file,'utf8'));
 if(prepared.username!=='adel'||prepared.role!=='SUPER_ADMIN'||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(prepared.passwordHash))throw new Error('INVALID_PREPARED_CREDENTIAL');
 const db=new PrismaClient({datasourceUrl:process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL});
 try{
  const user=await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(184209,3)::text`;
   if(await tx.dashboardUser.findUnique({where:{username:prepared.username}}))throw new Error('ACCOUNT_EXISTS_NOT_MODIFIED');
   const user=await tx.dashboardUser.create({data:{username:'adel',displayName:'Adel',role:'SUPER_ADMIN',passwordHash:prepared.passwordHash}});
   await tx.auditLog.create({data:{actor:'local-user-authorized-bootstrap',action:'USER_CREATED',entityType:'DashboardUser',entityId:user.id,message:'إنشاء المدير الأعلى بطلب المالك وكلمة مرور أُعدت محلياً',metadata:{username:user.username,role:user.role,enabled:user.enabled}}});
   return {id:user.id,username:user.username,role:user.role};
  });
  await unlink(file);console.log(JSON.stringify({created:user,preparedHashRemoved:true,existingUsersModified:0}));
 }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(['INVALID_PREPARED_CREDENTIAL','ACCOUNT_EXISTS_NOT_MODIFIED'].includes(error?.message)?error.message:'ACCOUNT_SETUP_FAILED_CHECK_STATE_BEFORE_RETRY');process.exitCode=1;});
