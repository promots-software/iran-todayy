import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient,Prisma} from '@prisma/client';
import {canaryAdmission,configureStagingCanary} from '../src/worker/staging-canary';
import {claimJob} from '../src/lib/processing/engine';
const id=()=> 'c'+randomUUID().replaceAll('-','').slice(0,24);
const env={IRAN_TODAY_ENVIRONMENT:'staging',TELEGRAM_CHAT_ID:'-1004436536617'};
const policy=(target=id(),databaseName='local')=>({version:'staging-canary-v1',mode:'CANARY_SELECTED',targetSourcePostId:target,databaseName,requestId:randomUUID(),authorizedBy:'offline-operator'});
for(const [name,value] of [['missing target',{}],['malformed target',{...policy(),targetSourcePostId:'bad'}],['wrong mode',{...policy(),mode:'NORMAL'}],['unknown fields',{...policy(),enabled:true}]] as const)test(name+' fails closed',()=>assert.equal(canaryAdmission({processingPaused:false,stagingCanaryPolicy:value},env).canaryClaimAllowed,false));
test('PAUSED beats a valid target and NORMAL unchanged without policy',()=>{assert.equal(canaryAdmission({processingPaused:true,stagingCanaryPolicy:policy()},env).canaryClaimAllowed,false);assert.equal(canaryAdmission({processingPaused:false,stagingCanaryPolicy:null},{}).processingMode,'NORMAL');assert.equal(canaryAdmission({processingPaused:false,stagingCanaryPolicy:null},{}).canaryClaimAllowed,true);});
for(const wrong of [{},{...env,IRAN_TODAY_ENVIRONMENT:'production'},{...env,TELEGRAM_CHAT_ID:'-1004297263933'}])test('environment/destination mismatch never opens normal queue '+JSON.stringify(wrong),()=>assert.equal(canaryAdmission({processingPaused:false,stagingCanaryPolicy:policy()},wrong).canaryClaimAllowed,false));
const dbTest={skip:!process.env.TEST_DATABASE_URL};
async function setup(run:(db:PrismaClient,target:string,job:string,p:ReturnType<typeof policy>)=>Promise<void>){
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url.toString()});const old={IRAN_TODAY_ENVIRONMENT:process.env.IRAN_TODAY_ENVIRONMENT,TELEGRAM_CHAT_ID:process.env.TELEGRAM_CHAT_ID};Object.assign(process.env,env);
 try{
  const source=await db.source.create({data:{name:'Offline',platform:'TELEGRAM',handle:id(),url:'https://example.invalid',enabled:true}});
  const target=id();await db.sourcePost.create({data:{id:target,sourceId:source.id,sourcePostId:id(),sourceUrl:'https://example.invalid/post',originalContent:'أعلنت إيران افتتاح مدرسة.',normalizedContent:'أعلنت إيران افتتاح مدرسة.',sourcePublishedAt:new Date(),contentHash:id()}});
  const job=await db.processingJob.create({data:{sourcePostId:target,stage:'PROCESS_V1'}});
  const p=policy(target,url.pathname.slice(1));await db.appSettings.update({where:{id:1},data:{processingPaused:true,stagingCanaryPolicy:Prisma.DbNull}});
  await run(db,target,job.id,p);
 }finally{await db.processingJob.updateMany({where:{status:'RUNNING'},data:{status:'COMPLETED',lockedAt:null,lockedBy:null}});await db.appSettings.update({where:{id:1},data:{processingPaused:true}});await db.$disconnect();for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
const install=async(db:PrismaClient,p:ReturnType<typeof policy>,paused=false)=>db.appSettings.update({where:{id:1},data:{stagingCanaryPolicy:p,processingPaused:paused}});
test('DB PAUSED zero; NORMAL uses existing queue',dbTest,()=>setup(async(db)=>{assert.equal(await claimJob(db,'paused'),null);await db.appSettings.update({where:{id:1},data:{processingPaused:false}});assert(await claimJob(db,'normal'));}));
test('atomic configuration preserves pause until explicit activation and audits activation',dbTest,()=>setup(async(db,target,job,p)=>{await configureStagingCanary(db,p);assert.equal(await claimJob(db,'held'),null);await configureStagingCanary(db,p,true);assert.equal((await claimJob(db,'active'))?.id,job);assert.equal(await db.auditLog.count({where:{action:'STAGING_CANARY_ACTIVATED',metadata:{path:['requestId'],equals:p.requestId}}}),1);assert.equal((await db.appSettings.findUniqueOrThrow({where:{id:1}})).processingPaused,false);}));
test('183 unrelated PENDING plus RETRY and expired RUNNING: only selected target, repeated terminal claims empty',dbTest,()=>setup(async(db,target,job,p)=>{
 const source=await db.sourcePost.findUniqueOrThrow({where:{id:target}});const posts=Array.from({length:185},()=>({id:id(),sourceId:source.sourceId,sourcePostId:id(),sourceUrl:'https://example.invalid/post',originalContent:'خبر آخر',sourcePublishedAt:new Date(),contentHash:id()}));await db.sourcePost.createMany({data:posts});await db.processingJob.createMany({data:posts.map((post,i)=>({sourcePostId:post.id,stage:'PROCESS_V1',status:i===183?'RETRY':i===184?'RUNNING':'PENDING',...(i===184?{lockedAt:new Date(0),lockedBy:'untouched'}:{})}))});
 await install(db,p);const claims=await Promise.all(Array.from({length:8},(_,i)=>claimJob(db,'lane-'+i,new Date(),true,[],i%2===0)));assert.deepEqual(claims.filter(Boolean).map(c=>c!.id),[job]);
 for(let i=0;i<4;i++)assert.equal(await claimJob(db,'again'),null);
 await db.processingJob.update({where:{id:job},data:{status:'COMPLETED',lockedAt:null,lockedBy:null}});await db.sourcePost.update({where:{id:target},data:{status:'PENDING_APPROVAL'}});
 for(let i=0;i<4;i++)assert.equal(await claimJob(db,'terminal'),null);
 assert.equal(await db.processingJob.count({where:{sourcePostId:{in:posts.slice(0,183).map(p=>p.id)},status:'PENDING'}}),183);assert.equal((await db.processingJob.findFirstOrThrow({where:{sourcePostId:posts[183].id}})).status,'RETRY');assert.equal((await db.processingJob.findFirstOrThrow({where:{sourcePostId:posts[184].id}})).lockedBy,'untouched');
}));
for(const status of ['COMPLETED','FAILED'] as const)test('terminal job '+status+' never falls through',dbTest,()=>setup(async(db,target,job,p)=>{await install(db,p);await db.processingJob.update({where:{id:job},data:{status}});assert.equal(await claimJob(db,'terminal'),null);}));
for(const error of ['APPLICATION_CONTINUATION_BUDGET','PROVIDER_COST_WAIT','GEMINI_HTTP_503'])test('same-job durable continuation '+error+' only',dbTest,()=>setup(async(db,target,job,p)=>{await install(db,p);assert.equal((await claimJob(db,'first'))?.id,job);await db.processingJob.update({where:{id:job},data:{status:'RETRY',lockedAt:null,lockedBy:null,lastError:error,availableAt:new Date(0)}});assert.equal((await claimJob(db,'continue'))?.id,job);assert.equal(await claimJob(db,'other-lane'),null);}));
for(const change of ['missing','wrong-db','disabled-source','held-source','future','attempts-exhausted','malformed','missing-target','wrong-env'])test('DB no fallback '+change,dbTest,()=>setup(async(db,target,job,p)=>{
 let value:unknown=p;
 if(change==='missing')value={...p,targetSourcePostId:id()};if(change==='wrong-db')value={...p,databaseName:'wrong'};if(change==='malformed')value={...p,targetSourcePostId:'bad'};if(change==='missing-target')value={mode:'CANARY_SELECTED'};
 await db.appSettings.update({where:{id:1},data:{processingPaused:false,stagingCanaryPolicy:value as Prisma.InputJsonValue}});
 if(change==='wrong-env')process.env.IRAN_TODAY_ENVIRONMENT='production';
 if(change==='disabled-source'||change==='held-source'){const post=await db.sourcePost.findUniqueOrThrow({where:{id:target}});await db.source.update({where:{id:post.sourceId},data:change==='disabled-source'?{enabled:false}:{processingPaused:true}});}
 if(change==='future')await db.processingJob.update({where:{id:job},data:{availableAt:new Date(Date.now()+3600000)}});
 if(change==='attempts-exhausted')await db.processingJob.update({where:{id:job},data:{attemptCount:99}});
 let reason:string|null=null;assert.equal(await claimJob(db,'blocked',new Date(),false,[],false,undefined,s=>{reason=s.canaryClaimBlockedReason;}),null);assert(reason);
}));
import {databaseCheckpoints,checkpointCall} from '../src/worker/checkpoints';
test('selected story checkpoint survives continuation without repeating completed work',dbTest,()=>setup(async(db,target,job,p)=>{
 await install(db,p);assert.equal((await claimJob(db,'first'))?.id,job);let executions=0;const store=databaseCheckpoints(db,target);
 assert.deepEqual(await checkpointCall(store,'offline-completed',async()=>{executions++;return {stage:'V0',frozen:true};}),{stage:'V0',frozen:true});
 await db.processingJob.update({where:{id:job},data:{status:'RETRY',lockedAt:null,lockedBy:null,lastError:'APPLICATION_CONTINUATION_BUDGET',availableAt:new Date(0)}});
 assert.equal((await claimJob(db,'continued'))?.id,job);assert.deepEqual(await checkpointCall(store,'offline-completed',async()=>{executions++;throw Error('MUST_NOT_REPEAT');}),{stage:'V0',frozen:true});assert.equal(executions,1);
}));
test('activation refuses running work and target replacement',dbTest,()=>setup(async(db,target,job,p)=>{
 await configureStagingCanary(db,p);await assert.rejects(configureStagingCanary(db,{...p,requestId:randomUUID()},true),/CANARY_TARGET_ALREADY_CONFIGURED/);
 await db.processingJob.update({where:{id:job},data:{status:'RUNNING',lockedAt:new Date(),lockedBy:'test'}});await assert.rejects(configureStagingCanary(db,p,true),/CANARY_RUNNING_JOBS_EXIST/);assert.equal((await db.appSettings.findUniqueOrThrow({where:{id:1}})).processingPaused,true);
}));
import {clearStagingCanary} from '../src/worker/staging-canary';
test('explicit canary deactivation preserves global pause and audits',dbTest,()=>setup(async(db,_target,_job,p)=>{
 await install(db,p,true);await clearStagingCanary(db,p.databaseName,'offline');const s=await db.appSettings.findUniqueOrThrow({where:{id:1}});assert.equal(s.processingPaused,true);assert.equal(s.stagingCanaryPolicy,null);assert.equal(await db.auditLog.count({where:{action:'STAGING_CANARY_DEACTIVATED'}}),1);
}));
test('canary deactivation refuses wrong DB or running queue',dbTest,()=>setup(async(db,_target,_job,p)=>{
 await install(db,p,true);await assert.rejects(clearStagingCanary(db,'wrong','offline'),/CANARY_DATABASE_MISMATCH/);await db.appSettings.update({where:{id:1},data:{processingPaused:false}});await assert.rejects(clearStagingCanary(db,p.databaseName,'offline'),/CANARY_SETUP_REQUIRES_PAUSE/);
}));
