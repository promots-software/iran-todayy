import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {operate} from '../src/lib/operations-controls';
import {automaticControlState} from '../src/lib/telegram/auto-control';
import {acknowledgePublisher} from '../src/worker/publisher-acknowledgement';
import {automaticDeliveryCycle} from '../src/lib/telegram/automatic-delivery';
const env={AUTO_PUBLISH:'true',SHADOW_MODE:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_CHAT_ID:'-100123'};
for(const role of ['SUPER_ADMIN','ADMIN','EDITOR'] as const)test(`${role}: Settings mode revisions, audit, acknowledgement, future-only boundary and restricted recovery`,{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
 const actor=await db.dashboardUser.create({data:{username:`mode-${role}`,displayName:'offline',passwordHash:'not-a-credential',role}});
 const policy={version:'telegram-auto-v1',id:randomUUID(),state:'CLOSED',reason:'OPERATOR_DISABLED',destination:env.TELEGRAM_CHAT_ID,notBefore:new Date(0).toISOString(),sourceIds:[],canaryCandidateId:null,authorizedBy:'offline'};
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
 const oldKey=await acknowledgePublisher(db,env,new Date(),'IDLE',null,15000,null);
 const action=(value:string,expected:string)=>({requestId:randomUUID(),kind:'AUTO_PUBLISH',target:'1',value,expected,confirmed:true});
 const on=action('true',oldKey);
 await assert.rejects(operate(db,actor.id,{...on,confirmed:false}));
 await operate(db,actor.id,on);assert.equal((await operate(db,actor.id,on)).changed,false);
 const active=(await db.appSettings.findUniqueOrThrow({where:{id:1}})).telegramAutoPolicy as unknown as typeof policy;
 assert.equal(active.state,'ACTIVE');assert.notEqual(active.id,policy.id);assert(new Date(active.notBefore)>new Date(policy.notBefore));
 let hb=await db.workerHeartbeat.findUniqueOrThrow({where:{id:'telegram-publisher-worker'}});
 assert.equal(automaticControlState(active,false,hb).enabled,false);
 const transport:typeof fetch=async()=>{throw Error('NO NETWORK ALLOWED');};
 assert.equal((await automaticDeliveryCycle(db,env,transport,undefined,oldKey)).status,'AWAITING_POLICY_ACKNOWLEDGEMENT');
 const key=await acknowledgePublisher(db,env,new Date(),'IDLE',null,15000,oldKey);
 hb=await db.workerHeartbeat.findUniqueOrThrow({where:{id:'telegram-publisher-worker'}});
 assert.equal(automaticControlState(active,false,hb).enabled,true);
 const audit=await db.auditLog.findFirstOrThrow({where:{action:'OPERATIONS_AUTO_PUBLISH',actor:`user:${actor.id}`}});
 const meta=audit.metadata as Record<string,unknown>;assert.equal(meta.role,role);assert.equal(meta.username,actor.username);assert.equal(meta.policyRevision,active.id);assert.equal(meta.requestedMode,'AUTOMATIC');
 assert.equal(await db.auditLog.count({where:{id:`publisher-ack:${key}`}}),1);
 await acknowledgePublisher(db,env,new Date(),'IDLE',null,15000,null);
 assert.equal(await db.auditLog.count({where:{id:`publisher-ack:${key}`}}),1);
 if(role!=='SUPER_ADMIN')for(const kind of ['AUTO_PUBLISH_RECOVERY','PUBLISHING_HOLD','PROCESSING_HOLD','RETRY'])await assert.rejects(operate(db,actor.id,{...action('false',key),kind}),/FORBIDDEN/);
 await operate(db,actor.id,action('false',key));
 const closed=(await db.appSettings.findUniqueOrThrow({where:{id:1}})).telegramAutoPolicy as unknown as typeof policy;
 assert.equal(closed.state,'CLOSED');assert.notEqual(closed.id,active.id);
 assert.equal((await automaticDeliveryCycle(db,env,transport)).status,'DISABLED');
 await acknowledgePublisher(db,env,new Date(),'IDLE',null,15000,key);
 hb=await db.workerHeartbeat.findUniqueOrThrow({where:{id:'telegram-publisher-worker'}});
 assert.equal(automaticControlState(closed,false,hb).observed,true);
 await db.dashboardUser.update({where:{id:actor.id},data:{enabled:false}});
 await assert.rejects(operate(db,actor.id,action('true',`${closed.id}:CLOSED`)),/FORBIDDEN/);
 assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});

test('new mode revision cannot hide an unresolved automatic send from an older revision',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});try{
 const actor=await db.dashboardUser.create({data:{username:'old-claim',displayName:'offline',passwordHash:'not-a-credential',role:'SUPER_ADMIN'}});
 const source=await db.source.create({data:{platform:'TELEGRAM',name:'offline',handle:'oldclaim',url:'https://t.me/oldclaim'}});
 const post=await db.sourcePost.create({data:{sourceId:source.id,sourcePostId:'1',sourceUrl:'https://t.me/oldclaim/1',originalContent:'نص محفوظ.',sourcePublishedAt:new Date()}});
 const draft=await db.humanEditorialDraft.create({data:{sourcePostId:post.id,title:'نص محفوظ.',body:'',originalSnapshot:{},editedBy:actor.id}});
 const old=await db.publication.create({data:{humanDraftId:draft.id,automaticPolicyId:randomUUID(),status:'UNKNOWN',destination:env.TELEGRAM_CHAT_ID,contentSnapshot:'نص محفوظ.',idempotencyKey:randomUUID()}});
 const policy={version:'telegram-auto-v1',id:randomUUID(),state:'CLOSED',reason:'OPERATOR_DISABLED',destination:env.TELEGRAM_CHAT_ID,notBefore:new Date().toISOString(),sourceIds:[source.id],canaryCandidateId:null,authorizedBy:'offline'};
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
 const key=await acknowledgePublisher(db,env,new Date(),'IDLE',null,15000,null);
 await assert.rejects(operate(db,actor.id,{kind:'AUTO_PUBLISH',requestId:randomUUID(),target:'1',value:'true',expected:key,confirmed:true}),/DELIVERY_RECONCILIATION_REQUIRED/);
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{...policy,state:'ACTIVE'}}});
 let sends=0;const result=await automaticDeliveryCycle(db,env,async()=>{sends++;throw Error('NO_SEND');});
 assert.equal(result.status,'STOPPED_UNCERTAIN');assert.equal(sends,0);
 assert.equal((await db.publication.findUniqueOrThrow({where:{id:old.id}})).status,'UNKNOWN');
 assert.equal((await db.appSettings.findUniqueOrThrow({where:{id:1}})).telegramAutoPolicy&&((await db.appSettings.findUniqueOrThrow({where:{id:1}})).telegramAutoPolicy as {state:string}).state,'CLOSED');
 }finally{await db.$disconnect();}
});
