/** Explicit operator bootstrap after migrations, never called by the application. */
import {PrismaClient} from '@prisma/client';
import {hashPassword} from '../src/lib/dashboard-auth';
async function main(){
const db=new PrismaClient();
try{
 const username=(process.env.ADMIN_USERNAME??'').trim().toLowerCase();const password=process.env.ADMIN_PASSWORD??'';
 if(!/^[a-z0-9_.@+-]{3,100}$/.test(username))throw new Error('BOOTSTRAP_CONFIG_REQUIRED');
 const passwordHash=await hashPassword(password);
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(184209,3)::text`;
  if(await tx.dashboardUser.count())throw new Error('BOOTSTRAP_ALREADY_COMPLETED');
  const user=await tx.dashboardUser.create({data:{username,displayName:'مدير المنصة',passwordHash,role:'ADMIN'}});
  await tx.auditLog.create({data:{actor:`user:${user.id}`,action:'USER_BOOTSTRAPPED',entityType:'DashboardUser',entityId:user.id,message:'إنشاء المدير الأول'}});
 });console.log('Initial administrator created. No credentials logged.');
}catch{console.error('Bootstrap stopped. Check configuration, password length (12–256), migrations, or existing users.');process.exitCode=1;}finally{await db.$disconnect();}
}
void main();
