'use server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {db} from '@/lib/db';
import {requireUser} from '@/lib/session';
import {hashPassword} from '@/lib/dashboard-auth';
import type {ActionState} from '@/app/actions';
export async function manageUserAction(_:ActionState,form:FormData):Promise<ActionState>{
 try{const actor=await requireUser(true);const id=z.string().max(100).parse(form.get('id')??'');const username=z.string().regex(/^[a-z0-9_.@+-]{3,100}$/).parse(String(form.get('username')??'').trim().toLowerCase());const displayName=z.string().trim().min(1).max(100).parse(form.get('displayName'));const role=z.enum(['ADMIN','EDITOR']).parse(form.get('role'));const enabled=form.get('enabled')==='on';const password=String(form.get('password')??'');const passwordHash=password?await hashPassword(password):undefined;if(!id&&!passwordHash)throw new Error('PASSWORD_REQUIRED');
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(184209,3)::text`;
  const old=id?await tx.dashboardUser.findUniqueOrThrow({where:{id}}):null;
  if(old?.role==='ADMIN'&&old.enabled&&(!enabled||role!=='ADMIN')&&await tx.dashboardUser.count({where:{role:'ADMIN',enabled:true}})<=1)throw new Error('LAST_ADMIN');
  const data={username,displayName,role,enabled,...(passwordHash?{passwordHash}:{})};
  const user=old?await tx.dashboardUser.update({where:{id},data}):await tx.dashboardUser.create({data:{...data,passwordHash:passwordHash!}});
  if(old)await tx.dashboardSession.deleteMany({where:{userId:id}});
  await tx.auditLog.create({data:{actor:`user:${actor.id}`,action:old?'USER_UPDATED':'USER_CREATED',entityType:'DashboardUser',entityId:user.id,message:old?'تحديث حساب مستخدم':'إضافة مستخدم',metadata:{username,displayName,role,enabled}}});
 });revalidatePath('/settings');return {ok:true,message:'تم حفظ الحساب. تغييرات الحساب تنهي جلساته السابقة.'};
 }catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='P2002')return {ok:false,message:'اسم المستخدم مستخدم بالفعل. اختر اسماً آخر.'};return {ok:false,message:'تعذر حفظ الحساب. يلزم اسم فريد وكلمة مرور من 12 إلى 256 حرفاً، ولا يمكن تعطيل آخر مدير.'};}
}
