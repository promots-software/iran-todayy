import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {operate} from '../src/lib/operations-controls';
import {automaticControlState} from '../src/lib/telegram/auto-control';
import {ingest} from '../src/lib/processing/engine';
const policy={version:'telegram-auto-v1',id:randomUUID(),state:'CLOSED',reason:'DELIVERY_PERSISTENCE_OR_SAFETY_FAILURE',destination:'-100123',notBefore:new Date(0).toISOString(),sourceIds:['source'],sourceNotBefore:{source:new Date(0).toISOString()},canaryCandidateId:null,authorizedBy:'owner'};
const heartbeat={lastSeenAt:new Date(),lastError:null,metadata:{autoPublish:true,shadowMode:false,requireApproval:true,externalPublishingEnabled:true,destination:policy.destination,policyId:policy.id,policyState:'CLOSED'}};
test('recovery requires acknowledged healthy CLOSED persistence failure, never enables delivery',()=>{
 const state=automaticControlState(policy,false,heartbeat);assert(state.canAcknowledge);assert(!state.canEnable);assert(!state.enabled);
 for(const reason of ['OPERATOR_DISABLED','CANARY_COMPLETE','DELIVERY_RECONCILIATION_REQUIRED'])assert(!automaticControlState({...policy,reason},false,heartbeat).canAcknowledge);
 assert(!automaticControlState(policy,true,heartbeat).canAcknowledge);
 assert(!automaticControlState(policy,false,{...heartbeat,lastSeenAt:new Date(0)}).canAcknowledge);
 assert(!automaticControlState(policy,false,{...heartbeat,metadata:{...heartbeat.metadata,policyState:'ACTIVE'}}).canAcknowledge);
});
test('SUPER_ADMIN recovery refuses unresolved claims, preserves publications and scope, audits once, stays OFF',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
  const actor=await db.dashboardUser.create({data:{username:'recovery-owner',displayName:'offline',passwordHash:'not-a-password',role:'SUPER_ADMIN'}});
  await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
  await db.workerHeartbeat.create({data:{id:'telegram-publisher-worker',state:'IDLE',phase:'PUBLISHING',...heartbeat}});
  const input={requestId:randomUUID(),kind:'AUTO_PUBLISH_RECOVERY',target:'1',value:'ACKNOWLEDGE',expected:`${policy.id}:CLOSED:${policy.reason}`,confirmed:true};
  await assert.rejects(operate(db,actor.id,{...input,confirmed:false}));
  await assert.rejects(operate(db,actor.id,{...input,expected:'stale'}),/STALE_CONTROL/);
  for(const role of ['ADMIN','EDITOR'] as const){await db.dashboardUser.update({where:{id:actor.id},data:{role}});await assert.rejects(operate(db,actor.id,input),/FORBIDDEN/);}
  await db.dashboardUser.update({where:{id:actor.id},data:{role:'SUPER_ADMIN',enabled:false}});await assert.rejects(operate(db,actor.id,input),/FORBIDDEN/);
  await db.dashboardUser.update({where:{id:actor.id},data:{enabled:true}});
  const source=await db.source.create({data:{platform:'TELEGRAM',handle:'offline-recovery',name:'offline',url:'https://t.me/offline'}});
  const post=await ingest(db,source.id,{externalId:'1',url:source.url+'/1',content:'محتوى ثابت',publishedAt:new Date()});
  const draft=await db.humanEditorialDraft.create({data:{sourcePostId:post.id,title:'محتوى ثابت',body:'',originalSnapshot:{},editedBy:actor.id}});
  const p=await db.publication.create({data:{humanDraftId:draft.id,automaticPolicyId:policy.id,destination:policy.destination,contentSnapshot:'محتوى ثابت',idempotencyKey:randomUUID()}});
  for(const status of ['PENDING','SENDING','UNKNOWN','FAILED'] as const){await db.publication.update({where:{id:p.id},data:{status}});await assert.rejects(operate(db,actor.id,input),/DELIVERY_RECONCILIATION_REQUIRED/);}
  await db.publication.update({where:{id:p.id},data:{status:'CANCELLED',attemptCount:1}});await assert.rejects(operate(db,actor.id,input),/DELIVERY_RECONCILIATION_REQUIRED/);
  await db.publication.update({where:{id:p.id},data:{attemptCount:0}});
  const frozen=await db.publication.findUniqueOrThrow({where:{id:p.id}});
  // An unrelated old manual PENDING publication is never adopted by recovery.
  await db.publication.create({data:{humanDraftId:draft.id,destination:policy.destination,contentSnapshot:'يدوي',idempotencyKey:randomUUID()}});
  assert((await operate(db,actor.id,input)).changed);assert(!(await operate(db,actor.id,input)).changed);
  const after=await db.appSettings.findUniqueOrThrow({where:{id:1}});
  assert.deepEqual(after.telegramAutoPolicy,{...policy,reason:'OPERATOR_DISABLED'});
  assert.deepEqual(await db.publication.findUniqueOrThrow({where:{id:p.id}}),frozen);
  assert.equal(await db.publicationAttempt.count(),0);
  assert.equal(await db.auditLog.count({where:{action:'OPERATIONS_AUTO_PUBLISH_RECOVERY',actor:`user:${actor.id}`}}),1);
  const state=automaticControlState(after.telegramAutoPolicy,false,heartbeat);assert(state.canEnable);assert(!state.enabled);
 }finally{await db.$disconnect();}
});
