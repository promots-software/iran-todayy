'use server';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {db} from '@/lib/db';
import {login,sessionCookie,tokenHash} from '@/lib/dashboard-auth';
export async function loginAction(_: {message:string},form:FormData){
 let result;try{result=await login(db,String(form.get('username')??''),String(form.get('password')??''));}catch{return {message:'تعذر تسجيل الدخول حالياً'};}
 if(!result)return {message:'تعذر تسجيل الدخول. تحقق من البيانات أو انتظر قليلاً قبل المحاولة.'};
 (await cookies()).set(sessionCookie,result.token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',expires:result.expiresAt});redirect('/');
}
export async function logoutAction(){
 const jar=await cookies(),token=jar.get(sessionCookie)?.value;
 if(token)await db.$transaction(async tx=>{
  const session=await tx.dashboardSession.findUnique({where:{tokenHash:tokenHash(token)}});
  await tx.dashboardSession.deleteMany({where:{tokenHash:tokenHash(token)}});
  if(session)await tx.auditLog.create({data:{actor:`user:${session.userId}`,action:'USER_LOGOUT',message:'تسجيل الخروج'}});
 });
 jar.delete(sessionCookie);redirect('/login');
}
