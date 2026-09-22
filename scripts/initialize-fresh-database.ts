/** Explicit operator-only bootstrap. Never invoked by builds or workers. */
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {sourceProfileSchema} from '../src/lib/processing/contracts';
import {autoPolicySchema} from '../src/lib/telegram/auto-policy';
import {hashPassword} from '../src/lib/dashboard-auth';

const configuration=z.object({
 destination:z.string().regex(/^-[1-9]\d*$/),
 sources:z.array(z.object({
  handle:z.string().regex(/^[a-z][a-z0-9_]{3,30}[a-z0-9]$/),name:z.string().min(1),
  processingMode:z.enum(['NORMAL','DIRECT']),editorialProfile:sourceProfileSchema,
  cursor:z.object({kind:z.literal('telegram-shadow-v1'),channelId:z.string().regex(/^\d+$/),lastId:z.number().int().positive()}).strict(),
  capturedAt:z.iso.datetime(),
 }).strict()).min(1),
}).strict();

async function main(){
 if(process.argv[2]!=='--confirm-fresh'||!process.argv[3])throw Error('EXPLICIT_FRESH_CONFIRMATION_REQUIRED');
 const input=configuration.parse(JSON.parse(await readFile(process.argv[3],'utf8')));
 if(new Set(input.sources.map(s=>s.handle)).size!==input.sources.length)throw Error('DUPLICATE_SOURCE');
 const passwordHash=await hashPassword(process.env.ADMIN_PASSWORD??'');
 const db=new PrismaClient({datasourceUrl:process.env.DIRECT_URL??process.env.DATABASE_URL});
 try{
  const result=await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(184209,3)::text`;
   // Refuse any existing application state, even if it appears disposable.
   const counts=await Promise.all([tx.source.count(),tx.sourcePost.count(),tx.newsItem.count(),tx.publication.count(),tx.publicationAttempt.count(),tx.processingJob.count(),tx.appSettings.count(),tx.dashboardUser.count(),tx.auditLog.count()]);
   if(counts.some(n=>n!==0))throw Error('DATABASE_NOT_FRESH');
   const admin=await tx.dashboardUser.create({data:{username:'adel',displayName:'Adel',role:'SUPER_ADMIN',passwordHash}});
   const sources=[];
   for(const {capturedAt,...source} of input.sources){
    const created=await tx.source.create({data:{...source,platform:'TELEGRAM',url:`https://t.me/${source.handle}`,enabled:true}});
    sources.push({id:created.id,handle:created.handle,capturedAt});
   }
   const policy=autoPolicySchema.parse({version:'telegram-auto-v1',id:randomUUID(),state:'CLOSED',destination:input.destination,
    notBefore:new Date().toISOString(),sourceIds:sources.map(s=>s.id),sourceNotBefore:Object.fromEntries(sources.map(s=>[s.id,s.capturedAt])),
    canaryCandidateId:null,authorizedBy:`user:${admin.id}`,reason:'OPERATOR_DISABLED'});
   await tx.appSettings.create({data:{id:1,publishingMode:'REQUIRE_APPROVAL',publishingPaused:false,processingPaused:false,telegramAutoPolicy:policy}});
   await tx.auditLog.create({data:{actor:`user:${admin.id}`,action:'FRESH_DATABASE_INITIALIZED',entityType:'AppSettings',entityId:'1',
    message:'Fresh database authorized by owner; no historical rows copied; automatic delivery CLOSED.',
    metadata:{sources:input.sources.map(s=>({handle:s.handle,cursor:s.cursor,capturedAt:s.capturedAt,processingMode:s.processingMode})),policyId:policy.id}}});
   return {admin:{username:admin.username,role:admin.role},sources,policyState:policy.state};
  },{timeout:30000});
  console.log(JSON.stringify(result));
 }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Fresh bootstrap stopped. Check empty database, local config, and credentials. No secret details logged.');process.exitCode=1;});
