import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {saveSource,changeSource} from '../src/lib/source-service';
import {operate} from '../src/lib/operations-controls';
import {autoPolicySchema} from '../src/lib/telegram/auto-policy';
import {reconcileSourceAuthorization} from '../src/lib/telegram/source-authorization';
const policy=autoPolicySchema.parse({version:'telegram-auto-v1',id:randomUUID(),state:'ACTIVE',destination:'-100123',notBefore:'2026-09-01T00:00:00.000Z',sourceIds:['existing'],canaryCandidateId:null,authorizedBy:'offline'});
test('reconciliation preserves existing boundary, adds prospective boundary, removes excluded IDs and never opens policy',()=>{
 const at='2026-09-22T14:00:00.000Z';const p=reconcileSourceAuthorization(policy,['existing','new'],at);
 assert.equal(p.sourceNotBefore?.existing,policy.notBefore);assert.equal(p.sourceNotBefore?.new,at);
 assert.deepEqual(reconcileSourceAuthorization(p,['new','existing'],at),p);
 const disabled=reconcileSourceAuthorization(p,[],at);assert.deepEqual(disabled.sourceIds,[]);
 const again=reconcileSourceAuthorization(disabled,['new'],'2026-09-23T00:00:00.000Z');assert.equal(again.sourceNotBefore?.new,'2026-09-23T00:00:00.000Z');
 assert.equal(reconcileSourceAuthorization({...policy,state:'CLOSED'},['new'],at).state,'CLOSED');
});
test('source add/enable/disable/archive/restore and Operations use one atomic authorization lifecycle',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
  await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:policy}});
  const read=async()=>autoPolicySchema.parse((await db.appSettings.findUniqueOrThrow({where:{id:1}})).telegramAutoPolicy);
  const src=await saveSource(db,{platform:'TELEGRAM',handle:'lifecycle',name:'offline',processingMode:'DIRECT'},'offline');
  let p=await read();assert(p.sourceIds.includes(src.id));const first=p.sourceNotBefore![src.id];assert(new Date(first)>=src.createdAt);
  await changeSource(db,src.id,'enable','offline');assert.equal((await read()).sourceNotBefore![src.id],first);
  const x=await saveSource(db,{platform:'X',handle:'placeholder',name:'offline'},'offline');assert(!(await read()).sourceIds.includes(x.id));
  await changeSource(db,src.id,'disable','offline');assert(!(await read()).sourceIds.includes(src.id));
  await changeSource(db,src.id,'enable','offline');p=await read();assert(p.sourceIds.includes(src.id));assert(new Date(p.sourceNotBefore![src.id])>new Date(first));
  await changeSource(db,src.id,'remove','offline');assert(!(await read()).sourceIds.includes(src.id));
  const restored=await saveSource(db,{platform:'TELEGRAM',handle:'lifecycle',name:'restored',processingMode:'DIRECT'},'offline');assert.equal(restored.id,src.id);assert((await read()).sourceIds.includes(src.id));
  const admin=await db.dashboardUser.create({data:{username:'source-super',displayName:'offline',passwordHash:'not-a-credential',role:'SUPER_ADMIN'}});
  await operate(db,admin.id,{kind:'SOURCE_ENABLED',requestId:randomUUID(),target:src.id,value:'false',expected:'true',confirmed:true});assert(!(await read()).sourceIds.includes(src.id));
  await operate(db,admin.id,{kind:'SOURCE_ENABLED',requestId:randomUUID(),target:src.id,value:'true',expected:'false',confirmed:true});assert((await read()).sourceIds.includes(src.id));
  assert.equal((await read()).id,policy.id);assert.equal((await read()).state,'ACTIVE');assert.equal(await db.publication.count(),0);
  assert(await db.auditLog.count({where:{action:'AUTOMATIC_SOURCE_AUTHORIZATION_SYNCED'}})>0);
 }finally{await db.$disconnect();}
});
