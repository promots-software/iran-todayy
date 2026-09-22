import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {automaticControlState} from '../src/lib/telegram/auto-control';
import {operate} from '../src/lib/operations-controls';
const policy={version:'telegram-auto-v1',id:randomUUID(),state:'ACTIVE',destination:'-100123',notBefore:'2026-09-01T00:00:00.000Z',sourceIds:['allowed-real-source'],canaryCandidateId:null,authorizedBy:'owner'};
const metadata={autoPublish:true,shadowMode:false,requireApproval:true,externalPublishingEnabled:true,destination:policy.destination,policyId:policy.id,policyState:'ACTIVE'};
const heartbeat=()=>({lastSeenAt:new Date(),lastError:null,metadata});
test('effective state requires fresh publisher acknowledgement and all capabilities',()=>{
 assert.equal(automaticControlState(policy,false,heartbeat()).enabled,true);
 for(const override of [{shadowMode:true},{externalPublishingEnabled:false},{autoPublish:false},{requireApproval:false},{destination:'-999'},{policyId:randomUUID()},{policyState:'CLOSED'}])assert.equal(automaticControlState(policy,false,{...heartbeat(),metadata:{...metadata,...override}}).enabled,false);
 assert.equal(automaticControlState(policy,true,heartbeat()).enabled,false);
 assert.equal(automaticControlState(policy,false,{...heartbeat(),lastSeenAt:new Date(0)}).enabled,false);
 assert.equal(automaticControlState(policy,false,{...heartbeat(),lastError:'ERROR'}).enabled,false);
 assert.equal(automaticControlState(policy,false,null).enabled,false);
});
test('only operator-disabled authorization may be resumed; safety closures and canary stay locked',()=>{
 assert(automaticControlState({...policy,state:'CLOSED',reason:'OPERATOR_DISABLED'},false,heartbeat()).canEnable);
 for(const reason of ['DELIVERY_RECONCILIATION_REQUIRED','DELIVERY_PERSISTENCE_OR_SAFETY_FAILURE','CANARY_COMPLETE',undefined])assert.equal(automaticControlState({...policy,state:'CLOSED',reason},false,heartbeat()).canEnable,false);
 assert.equal(automaticControlState({...policy,state:'CANARY'},false,heartbeat()).canDisable,false);
 assert.equal(automaticControlState({...policy,state:'CLOSED',reason:'OPERATOR_DISABLED'},true,heartbeat()).canEnable,false);
});
test('DB control is audited, role-fenced, idempotent and preserves scope; OFF remains possible without heartbeat',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
  const actor=await db.dashboardUser.create({data:{username:'control-test',displayName:'offline',passwordHash:'not-a-credential',role:'SUPER_ADMIN'}});
  await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
  const action=(value:string,state:string)=>({requestId:randomUUID(),kind:'AUTO_PUBLISH',target:'1',value,expected:`${policy.id}:${state}`,confirmed:true});
  const off=action('false','ACTIVE');await operate(db,actor.id,off);assert.equal((await operate(db,actor.id,off)).changed,false);
  const closed=await db.appSettings.findUniqueOrThrow({where:{id:1}});assert.deepEqual(closed.telegramAutoPolicy,{...policy,state:'CLOSED',reason:'OPERATOR_DISABLED'});assert.equal(closed.publishingPaused,false);
  await assert.rejects(operate(db,actor.id,action('true','CLOSED')),/AUTOMATIC_ENABLE_BLOCKED/);
  await db.workerHeartbeat.create({data:{id:'telegram-publisher-worker',state:'IDLE',phase:'PUBLISHING',startedAt:new Date(),lastSeenAt:new Date(),metadata:{...metadata,policyState:'CLOSED'}}});
  await assert.rejects(operate(db,actor.id,action('true','ACTIVE')),/STALE_CONTROL/);
  await operate(db,actor.id,action('true','CLOSED'));assert.deepEqual((await db.appSettings.findUniqueOrThrow({where:{id:1}})).telegramAutoPolicy,policy);
  assert.equal(await db.auditLog.count({where:{action:'OPERATIONS_AUTO_PUBLISH',actor:`user:${actor.id}`}}),2);
  await db.dashboardUser.update({where:{id:actor.id},data:{role:'ADMIN'}});await assert.rejects(operate(db,actor.id,action('false','ACTIVE')),/FORBIDDEN/);
  assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});

 test('saved ACTIVE policy remains pending until publisher acknowledges, then OFF similarly settles',()=>{
 const old={...heartbeat(),metadata:{...metadata,policyState:'CLOSED'}};
 const pending=automaticControlState(policy,false,old);assert.equal(pending.enabled,false);assert.equal(pending.reason,'AWAITING_PUBLISHER');
 assert.equal(automaticControlState(policy,false,heartbeat()).enabled,true);
 const closed={...policy,state:'CLOSED',reason:'OPERATOR_DISABLED'};assert.equal(automaticControlState(closed,false,heartbeat()).reason,'AWAITING_PUBLISHER');
 const settled=automaticControlState(closed,false,old);assert.equal(settled.enabled,false);assert.equal(settled.observed,true);assert.equal(settled.reason,'DISABLED');
 });
