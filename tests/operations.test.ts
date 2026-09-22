import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {allowed,assertSuperAdmin,assertUserManagement,roleLabel} from '../src/lib/dashboard-permissions';
import {beirutDayStart,usageSummary,safeCode} from '../src/lib/operations';
import {operate,assertPublishingActive} from '../src/lib/operations-controls';
import {ingest,claimJob} from '../src/lib/processing/engine';
test('SUPER_ADMIN only operations access including direct URLs; ordinary roles preserved',()=>{
 for(const path of ['/operations','/operations/failures','/operations/posts/id']){assert(allowed('SUPER_ADMIN',path));assert(!allowed('ADMIN',path));assert(!allowed('EDITOR',path));}
 for(const role of ['ADMIN','EDITOR'] as const)assert.throws(()=>assertSuperAdmin(role));
 assert.doesNotThrow(()=>assertSuperAdmin('SUPER_ADMIN'));assert(allowed('ADMIN','/settings'));assert(!allowed('EDITOR','/settings'));assert.equal(roleLabel('SUPER_ADMIN'),'المدير الأعلى');
});
test('ADMIN cannot elevate itself or alter SUPER_ADMIN; EDITOR cannot manage any user',()=>{
 for(const role of ['ADMIN','EDITOR','SUPER_ADMIN'] as const){assert.throws(()=>assertUserManagement('EDITOR',role));assert.throws(()=>assertUserManagement('ADMIN',role,'SUPER_ADMIN'));assert.doesNotThrow(()=>assertUserManagement('SUPER_ADMIN',role));}
 assert.throws(()=>assertUserManagement('ADMIN','SUPER_ADMIN'));assert.doesNotThrow(()=>assertUserManagement('ADMIN','EDITOR','ADMIN'));
});
test('usage accounting separates network/replay/missing tokens and errors',()=>{
 const s=usageSummary([{metadata:{httpStatus:200,inputTokens:100,outputTokens:20,thinkingTokens:0,estimatedCostUsd:.1,stage:'direct_extract',durationMs:20}},{metadata:{httpStatus:429,stage:'direct_extract'}},{metadata:{httpStatus:503,stage:'direct_review'}},{metadata:{httpStatus:200,replayed:true,inputTokens:1000}},{metadata:{httpStatus:null,stage:'direct_review'}}]);
 assert.equal(s.attempts,4);assert.equal(s.replays,1);assert.equal(s.success,1);assert.equal(s.rateLimited,1);assert.equal(s.serverErrors,1);assert.equal(s.otherFailures,1);assert.equal(s.input,100);assert.equal(s.output,20);assert.equal(s.missingUsage,3);assert.equal(s.estimatedUsd,.1);
});
test('Beirut day boundaries respect seasonal timezone and safe codes exclude raw strings',()=>{assert.equal(beirutDayStart(new Date('2026-09-22T07:00:00Z')).toISOString(),'2026-09-21T21:00:00.000Z');assert.equal(beirutDayStart(new Date('2026-01-22T07:00:00Z')).toISOString(),'2026-01-21T22:00:00.000Z');assert.equal(safeCode('https://private.invalid/?token=hidden'),'غير مصنف');});
test('local DB: holds independent, source mode dynamic, idempotent action, safe retry, role revocation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
  const user=await db.dashboardUser.create({data:{username:'offline-super',displayName:'اختبار',passwordHash:'not-a-credential',role:'SUPER_ADMIN'}});
  const source=await db.source.create({data:{platform:'TELEGRAM',handle:'opstest',name:'اختبار',url:'https://t.me/opstest'}});
  const action=(kind:string,target:string,value:string,expected:string)=>({requestId:randomUUID(),kind,target,value,expected,confirmed:true});
  const change=action('SOURCE_MODE',source.id,'DIRECT','NORMAL');assert.equal((await operate(db,user.id,change)).changed,true);assert.equal((await operate(db,user.id,change)).changed,false);assert.equal(await db.auditLog.count({where:{id:`operation:${change.requestId}`}}),1);
  await assert.rejects(operate(db,user.id,{...change,value:'NORMAL'}),/REQUEST_ID_REUSED/);
  await assert.rejects(operate(db,user.id,action('SOURCE_MODE',source.id,'NORMAL','NORMAL')),/STALE_CONTROL/);
  await operate(db,user.id,action('PUBLISHING_HOLD','1','true','false'));
  await assert.rejects(db.$transaction(tx=>assertPublishingActive(tx)),/OPERATIONS_PUBLISHING_PAUSED/);
  const p=await ingest(db,source.id,{externalId:'1',url:source.url+'/1',content:'افتتح المجلس مدرسة جديدة.',publishedAt:new Date()});
  await operate(db,user.id,action('PROCESSING_HOLD','1','true','false'));assert.equal(await claimJob(db,'paused'),null);assert.equal(await db.sourcePost.count({where:{id:p.id}}),1);
  await operate(db,user.id,action('PROCESSING_HOLD','1','false','true'));
  await operate(db,user.id,action('SOURCE_PROCESSING_HOLD',source.id,'true','false'));assert.equal(await claimJob(db,'sourcepaused'),null);
  await operate(db,user.id,action('SOURCE_PROCESSING_HOLD',source.id,'false','true'));const j=await claimJob(db,'resumed');assert(j);
  await db.processingJob.update({where:{id:j.id},data:{status:'FAILED',lastError:'LEASE_EXHAUSTED',attemptCount:5,maxAttempts:5}});
  const failed=await db.processingJob.findUniqueOrThrow({where:{id:j.id}});const retry=action('RETRY',j.id,'RETRY',failed.updatedAt.toISOString());await operate(db,user.id,retry);await operate(db,user.id,retry);assert.equal((await db.processingJob.findUniqueOrThrow({where:{id:j.id}})).maxAttempts,6);assert.equal(await db.processingJob.count({where:{sourcePostId:p.id}}),1);
  await db.processingJob.update({where:{id:j.id},data:{status:'FAILED',lastError:'PROCESSING_FAILED'}});
  await db.auditLog.create({data:{action:'WORKER_PROVIDER_STAGE_STARTED',entityType:'SourcePost',entityId:p.id,message:'offline',metadata:{key:'unknown'}}});
  const unknown=await db.processingJob.findUniqueOrThrow({where:{id:j.id}});await assert.rejects(operate(db,user.id,action('RETRY',j.id,'RETRY',unknown.updatedAt.toISOString())),/RETRY_REQUIRES_RECONCILIATION/);
  await db.dashboardUser.update({where:{id:user.id},data:{role:'ADMIN'}});await assert.rejects(operate(db,user.id,action('PUBLISHING_HOLD','1','false','true')),/FORBIDDEN/);
  assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});
