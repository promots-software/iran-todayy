import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {PrismaClient,Prisma} from '@prisma/client';
import {configureStagingBatch,stagingBatchSchema} from '../src/worker/staging-batch';import {claimJob} from '../src/lib/processing/engine';import {canaryAdmission} from '../src/worker/staging-canary';
const env={IRAN_TODAY_ENVIRONMENT:'staging',TELEGRAM_CHAT_ID:'-1004436536617'};
const policy=(databaseName='local')=>({version:'staging-batch-v1' as const,mode:'BATCH_30' as const,limit:30 as const,sourcePostIds:[] as string[],notBefore:new Date(Date.now()-60000).toISOString(),databaseName,requestId:randomUUID(),authorizedBy:'offline',settledAt:null});
test('30-bound schema and environment fail closed',()=>{const p=policy();for(const bad of [{...p,limit:31},{...p,sourcePostIds:['bad']},{...p,sourcePostIds:['c123456789012345678901234','c123456789012345678901234']}])assert.equal(stagingBatchSchema.safeParse(bad).success,false);assert.equal(canaryAdmission({processingPaused:false,stagingCanaryPolicy:p},{...env,TELEGRAM_CHAT_ID:'-1004297263933'}).canaryClaimAllowed,false);assert.equal(canaryAdmission({processingPaused:false,stagingCanaryPolicy:p},env).processingMode,'BATCH_30');});
test('concurrent lanes/restart/retry cannot admit 31; terminal cohort automatically pauses',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const u=new URL(process.env.TEST_DATABASE_URL!);assert.equal(u.hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:u.href});const old={IRAN_TODAY_ENVIRONMENT:process.env.IRAN_TODAY_ENVIRONMENT,TELEGRAM_CHAT_ID:process.env.TELEGRAM_CHAT_ID};Object.assign(process.env,env);
 try{
  await db.appSettings.update({where:{id:1},data:{processingPaused:true,stagingCanaryPolicy:Prisma.DbNull}});
  const source=await db.source.create({data:{name:'Offline batch',handle:randomUUID(),url:'https://example.invalid',platform:'TELEGRAM'}});
  const ids:string[]=[];for(let i=0;i<45;i++){const p=await db.sourcePost.create({data:{sourceId:source.id,sourcePostId:String(i),sourceUrl:'https://example.invalid',originalContent:'خبر إيران',sourcePublishedAt:new Date(),ingestedAt:new Date(Date.now()+i)}});ids.push(p.id);await db.processingJob.create({data:{sourcePostId:p.id,stage:'PROCESS_V1'}});}
  const excluded:string[]=[];for(const prior of [true,false]){const post=await db.sourcePost.create({data:{sourceId:source.id,sourcePostId:randomUUID(),sourceUrl:'https://example.invalid',originalContent:'excluded',sourcePublishedAt:new Date(),ingestedAt:prior?new Date():new Date(0),processingStartedAt:prior?new Date():null}});excluded.push(post.id);await db.processingJob.create({data:{sourcePostId:post.id,stage:'PROCESS_V1'}});}
  const p=policy(u.pathname.slice(1));await configureStagingBatch(db,p);
  await assert.rejects(configureStagingBatch(db,p),/BATCH_PREFLIGHT_FAILED/);
  const claimed=[];for(let round=0;round<10;round++)claimed.push(...(await Promise.all(Array.from({length:4},(_,i)=>claimJob(db,'lane'+i,new Date(),true,[],true)))).filter(x=>x!==null));
  assert.equal(claimed.length,30);assert.ok(claimed.every(c=>!excluded.includes(c.sourcePostId)));assert.equal(new Set(claimed.map(x=>x.sourcePostId)).size,30);
  const frozen=stagingBatchSchema.parse((await db.appSettings.findUniqueOrThrow({where:{id:1}})).stagingCanaryPolicy);assert.equal(frozen.sourcePostIds.length,30);assert.equal(await db.processingJob.count({where:{sourcePostId:{in:ids},status:'PENDING'}}),15);
  const retry=claimed[0];await db.processingJob.updateMany({where:{sourcePostId:{in:frozen.sourcePostIds}},data:{status:'COMPLETED',lockedAt:null,lockedBy:null}});await db.processingJob.update({where:{id:retry.id},data:{status:'RETRY',availableAt:new Date(Date.now()+60000)}});
  assert.equal(await claimJob(db,'restarted',new Date(),true),null);assert.equal((await db.appSettings.findUniqueOrThrow({where:{id:1}})).processingPaused,false);
  await db.processingJob.update({where:{id:retry.id},data:{availableAt:new Date(0)}});assert.equal((await claimJob(db,'retry',new Date(),true))?.id,retry.id);assert.equal(await claimJob(db,'extra',new Date(),true),null);
  await db.processingJob.update({where:{id:retry.id},data:{status:'FAILED',lockedAt:null,lockedBy:null}});assert.equal(await claimJob(db,'settle',new Date(),true),null);
  const settled=await db.appSettings.findUniqueOrThrow({where:{id:1}});assert.equal(settled.processingPaused,true);assert.equal(stagingBatchSchema.parse(settled.stagingCanaryPolicy).sourcePostIds.length,30);assert.equal(await db.auditLog.count({where:{action:'STAGING_BATCH_MEMBER_CLAIMED'}}),30);assert.equal(await db.auditLog.count({where:{action:'STAGING_BATCH_SETTLED'}}),1);
  for(let i=0;i<3;i++)assert.equal(await claimJob(db,'after'),null);
 }finally{await db.$disconnect();for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
