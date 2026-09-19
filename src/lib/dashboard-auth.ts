import {randomBytes,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import type {PrismaClient} from '@prisma/client';
const derive=promisify(scrypt);
export {allowed,assertRole} from './dashboard-permissions';
export const sessionCookie='iran-dashboard-session';
export const tokenHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function hashPassword(password:string){
 if(password.length<12||password.length>256)throw new Error('PASSWORD_LENGTH');
 const salt=randomBytes(16).toString('hex');const hash=await derive(password,salt,64) as Buffer;
 return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password:string,stored:string){
 if(password.length>256)return false;
 const [method,salt,encoded]=stored.split(':');if(method!=='scrypt'||!salt||!encoded||!/^[a-f0-9]{128}$/.test(encoded))return false;
 const hash=await derive(password,salt,64) as Buffer;return timingSafeEqual(hash,Buffer.from(encoded,'hex'));
}
export async function sessionUser(db:PrismaClient,token?:string){
 if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 const session=await db.dashboardSession.findUnique({where:{tokenHash:tokenHash(token)},include:{user:{select:{id:true,username:true,displayName:true,role:true,enabled:true}}}});
 return session&&session.expiresAt>new Date()&&session.user.enabled?session.user:null;
}
export async function login(db:PrismaClient,username:string,password:string){
 username=username.trim().toLowerCase();if(!/^[a-z0-9_.@+-]{3,100}$/.test(username)||password.length>256)return null;
 // Database-backed throttle works across instances; never logs attempted credentials.
 const key=tokenHash(username),now=new Date();
 const permit=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(184209,2)::text`;
  const old=await tx.loginThrottle.findUnique({where:{key}});
  if(old&&now.getTime()-old.windowStart.getTime()<900000&&old.attempts>=10)return false;
  await tx.loginThrottle.upsert({where:{key},create:{key,attempts:1},update:!old||now.getTime()-old.windowStart.getTime()>=900000?{attempts:1,windowStart:now}:{attempts:{increment:1}}});return true;
 });
 if(!permit)return null;
 const user=await db.dashboardUser.findUnique({where:{username}});
 const dummy='scrypt:00000000000000000000000000000000:'+ '0'.repeat(128);
 const valid=await verifyPassword(password,user?.passwordHash??dummy);
 if(!user?.enabled||!valid)return null;
 const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+8*3600000);
 await db.$transaction(async tx=>{
  await tx.dashboardSession.create({data:{tokenHash:tokenHash(token),userId:user.id,expiresAt}});
  await tx.auditLog.create({data:{actor:`user:${user.id}`,action:'USER_LOGIN',entityType:'DashboardUser',entityId:user.id,message:'تسجيل الدخول'}});
 });return {token,expiresAt};
}
