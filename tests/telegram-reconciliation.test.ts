import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {recordDeliveryReceipt,reconcileDelivery,retryPersistence} from '../src/lib/telegram/delivery-receipt';
import {processingEnvironment,publishingEnvironment} from '../src/worker/production-roles';
import {requireAutoPolicy} from '../src/lib/telegram/auto-policy';
const env={AUTO_PUBLISH:'true',SHADOW_MODE:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_CHAT_ID:'-100123'};
test('role isolation never arms ingestion/provider runtime and publisher receives no AI/session secrets',()=>{
 const original={...env,NODE_ENV:'test' as const,GEMINI_API_KEY:'offline',TELEGRAM_SESSION:'offline',TELEGRAM_API_HASH:'offline'};
 const p=processingEnvironment(original),d=publishingEnvironment(original);assert.equal(p.SHADOW_MODE,'true');assert.equal(p.AUTO_PUBLISH,'false');assert.equal(p.TELEGRAM_PUBLISH_ENABLED,'false');assert.equal(d.AUTO_PUBLISH,'true');assert.equal(d.GEMINI_API_KEY,undefined);assert.equal(d.TELEGRAM_SESSION,undefined);assert.equal(d.TELEGRAM_API_HASH,undefined);assert.equal(original.SHADOW_MODE,'false');
});
test('explicit runtime gates and closed/malformed policy fail closed',()=>{
 const p={version:'telegram-auto-v1',id:randomUUID(),state:'ACTIVE',destination:'-100123',notBefore:new Date().toISOString(),sourceIds:['real'],canaryCandidateId:null,authorizedBy:'owner'};
 assert.equal(requireAutoPolicy(p,env).id,p.id);
 for(const patch of [{AUTO_PUBLISH:'false'},{SHADOW_MODE:'true'},{REQUIRE_APPROVAL:'false'},{TELEGRAM_PUBLISH_ENABLED:'false'},{TELEGRAM_CHAT_ID:'-999'}])assert.throws(()=>requireAutoPolicy(p,{...env,...patch}));
 assert.throws(()=>requireAutoPolicy({...p,state:'CLOSED'},env));assert.throws(()=>requireAutoPolicy({...p,state:'CANARY'},env));assert.throws(()=>requireAutoPolicy(null,env));
});
test('only DB persistence retried, at most three attempts',async()=>{let calls=0;assert.equal(await retryPersistence(async()=>{if(++calls<3)throw Error('DB');return 42;}),42);assert.equal(calls,3);calls=0;await assert.rejects(retryPersistence(async()=>{calls++;throw Error('DB');}));assert.equal(calls,3);});
test('durable receipt recovery, restart, uncertainty and conflicting acknowledgement',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
 const make=async(pending=false)=>{const id=randomUUID();const event=await db.canonicalEvent.create({data:{title:'offline',summary:'offline',facts:{},revisions:{create:{revision:1,facts:{}}}},include:{revisions:true}});const item=await db.newsItem.create({data:{title:'خبر',arabicContent:'',eventRevisionId:event.revisions[0].id}});const p=await db.publication.create({data:{newsItemId:item.id,idempotencyKey:id,destination:'-100123',contentSnapshot:'خبر',status:pending?'PENDING':'SENDING',attemptCount:pending?0:1,claimedAt:pending?null:new Date(0)}});if(!pending)await db.publicationAttempt.create({data:{publicationId:p.id,attempt:1}});return p;};
 await t.test('acknowledgement survives final transaction failure and restart',async()=>{const p=await make();await recordDeliveryReceipt(db,p.id,p.idempotencyKey,{status:'SENT',chatId:p.destination,messageId:'71'});const r=await reconcileDelivery(db,p.id);assert.equal(r.status,'SENT');const row=await db.publication.findUniqueOrThrow({where:{id:p.id}});assert.equal(row.telegramMessageId,'71');assert.equal(await db.auditLog.count({where:{entityId:p.id,action:'PUBLICATION_SENT'}}),1);await reconcileDelivery(db,p.id);assert.equal(await db.auditLog.count({where:{entityId:p.id,action:'PUBLICATION_SENT'}}),1);});
 await t.test('crash without acknowledgement becomes UNKNOWN, never a fabricated success',async()=>{const p=await make();assert.equal((await reconcileDelivery(db,p.id)).status,'UNKNOWN');assert.equal((await db.publication.findUniqueOrThrow({where:{id:p.id}})).telegramMessageId,null);assert.equal((await reconcileDelivery(db,p.id)).changed,false);});
 await t.test('current in-flight claim is not mistaken for a stale crash',async()=>{const p=await make();await db.publication.update({where:{id:p.id},data:{claimedAt:new Date()}});assert.equal((await reconcileDelivery(db,p.id)).status,'SENDING');});
 await t.test('explicit rejection and ambiguous timeout persist distinct states',async()=>{for(const status of ['FAILED','UNKNOWN'] as const){const p=await make();await recordDeliveryReceipt(db,p.id,p.idempotencyKey,{status,error:'TELEGRAM_DELIVERY_UNCERTAIN'});assert.equal((await reconcileDelivery(db,p.id)).status,status);}});
 await t.test('historical pending is never claimed or reconciled into SENT',async()=>{const p=await make(true);assert.equal((await reconcileDelivery(db,p.id)).status,'PENDING');assert.equal(await db.publicationAttempt.count({where:{publicationId:p.id}}),0);});
 await t.test('receipt cannot be replaced or assigned to a different destination',async()=>{const p=await make();await recordDeliveryReceipt(db,p.id,p.idempotencyKey,{status:'SENT',chatId:'-999',messageId:'72'});await assert.rejects(reconcileDelivery(db,p.id),/DELIVERY_RECEIPT_CONFLICT/);await assert.rejects(recordDeliveryReceipt(db,p.id,p.idempotencyKey,{status:'SENT',chatId:'-100123',messageId:'72'}),/DELIVERY_RECEIPT_CONFLICT/);});
 }finally{await db.$disconnect();}
});
