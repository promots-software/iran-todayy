import {NextRequest,NextResponse} from 'next/server';
import {db} from './lib/db';
import {allowed,sessionCookie,sessionUser} from './lib/dashboard-auth';
export async function proxy(request:NextRequest){
 const path=request.nextUrl.pathname;
 if(path==='/login')return NextResponse.next();
 try{
  const user=await sessionUser(db,request.cookies.get(sessionCookie)?.value);
  if(!user)return NextResponse.redirect(new URL('/login',request.url));
  if(!allowed(user.role,path))return new NextResponse('غير مصرح',{status:403});
  const response=NextResponse.next();response.headers.set('Cache-Control','private, no-store, max-age=0');return response;
 }catch{return new NextResponse('تعذر التحقق من الجلسة',{status:503,headers:{'Cache-Control':'no-store'}});}
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|api/health$).*)']};
