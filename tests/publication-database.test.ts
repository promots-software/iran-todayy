import {reconcileDelivery} from '../src/lib/telegram/delivery-receipt';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {approvePublication,approvalDigest,publishOne,publishApprovedManually,reviewKey} from '../src/lib/telegram/publisher';
import {fixture} from './fixtures/processing';

test('manual approval freezes content, concurrent delivery sends once, uncertain sends cannot repeat',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
 const db=new PrismaClient({datasourceUrl:url});const tag=randomUUID();
 const env={TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123',SHADOW_MODE:'false',TELEGRAM_PUBLISH_ENABLED:'true'};
 const ids:string[]=[],events:string[]=[];let sourceId='';
 const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
 try{
  await db.appSettings.upsert({where:{id:1},create:{id:1,publishingMode:'REQUIRE_APPROVAL'},update:{publishingMode:'REQUIRE_APPROVAL'}});
  const source=await db.source.create({data:{platform:'TELEGRAM',handle:`test-${tag}`,name:'synthetic',url:'https://t.me/test'}});sourceId=source.id;
  async function draft(review:{code:string;detail?:string}[]=[{code:'SHADOW_MODE_REVIEW'}]){
   const f=fixture('outbound','قال المتحدث إن الاجتماع انتهى.','ar','قال المتحدث إن الاجتماع انتهى.');
   const p=await db.sourcePost.create({data:{sourceId,sourcePostId:randomUUID(),sourceUrl:'https://t.me/test/1',originalContent:f.content,sourcePublishedAt:new Date()}});
   f.understanding.event.facts.forEach(x=>{x.evidence.sourcePostId=p.id;});
   const e=await db.canonicalEvent.create({data:{title:f.draft.title,summary:f.draft.title,facts:json(f.understanding.event),revisions:{create:{revision:1,facts:json(f.understanding.event)}}},include:{revisions:true}});events.push(e.id);
   const item=await db.newsItem.create({data:{eventRevisionId:e.revisions[0].id,title:f.draft.title,arabicContent:f.draft.body+'\n\n#إيران_الآن',status:'NEEDS_REVIEW',validationStatus:'NEEDS_REVIEW',factualEvidence:json(f.understanding.event.facts),validationResult:json({review,sentenceEvidence:f.draft.sentences}),evidence:{create:{sourcePostId:p.id}}}});ids.push(item.id);
   return {item,input:{newsItemId:item.id,digest:approvalDigest(item),resolutions:review.map(r=>({key:reviewKey(r),note:'Human reviewer checked source evidence and accepts this review.'}))}};
  }
  const a=await draft();
  await assert.rejects(approvePublication(db,{...a.input,resolutions:[]},'test',env),/EXPLICIT_REVIEW_REQUIRED/);
  await assert.rejects(approvePublication(db,{...a.input,digest:'stale'},'test',env),/DRAFT_CHANGED/);
  const approved=await Promise.all([approvePublication(db,a.input,'editor',env),approvePublication(db,a.input,'editor',env)]);
  assert.equal(approved[0].id,approved[1].id);assert.equal(await db.publication.count({where:{newsItemId:a.item.id}}),1);
  const manualEnv={...env,SHADOW_MODE:'true',AUTO_PUBLISH:'false',REQUIRE_APPROVAL:'true',TELEGRAM_PUBLISH_ENABLED:'false',TELEGRAM_MANUAL_PUBLISH_ENABLED:'true'};
  const input=(p:{id:string;idempotencyKey:string;destination:string})=>({publicationId:p.id,digest:p.idempotencyKey,destination:p.destination,confirmed:true});
  let calls=0;const transport:typeof fetch=async()=>{calls++;return Response.json({ok:true,result:{message_id:123,chat:{id:-100123}}});};
  await assert.rejects(publishOne(db,approved[0].id,{...env,SHADOW_MODE:'true'},transport),/PUBLISH_DISABLED/);
  await assert.rejects(publishApprovedManually(db,input(approved[0]),'',manualEnv,transport),/AUTHENTICATION_REQUIRED/);
  await assert.rejects(publishApprovedManually(db,{...input(approved[0]),confirmed:false},'editor',manualEnv,transport),/EXPLICIT_SEND_REQUIRED/);
  await assert.rejects(publishApprovedManually(db,{...input(approved[0]),destination:'-100999'},'editor',manualEnv,transport),/PUBLICATION_PREVIEW_CHANGED/);
  await assert.rejects(publishApprovedManually(db,{...input(approved[0]),digest:'stale'},'editor',manualEnv,transport),/PUBLICATION_PREVIEW_CHANGED/);
  for(const patch of [{AUTO_PUBLISH:'true'},{REQUIRE_APPROVAL:'false'},{TELEGRAM_MANUAL_PUBLISH_ENABLED:'false'},{SHADOW_MODE:'false'}])await assert.rejects(publishApprovedManually(db,input(approved[0]),'editor',{...manualEnv,...patch},transport),/MANUAL_PUBLISH_DISABLED/);
  assert.equal(calls,0);
  const beforeSendFailure=new Proxy(db,{get(target,key){if(key==='$transaction')return async()=>{throw Error('DB_BEFORE_SEND');};return Reflect.get(target,key);}});
  await assert.rejects(publishApprovedManually(beforeSendFailure,input(approved[0]),'editor',manualEnv,transport),/DB_BEFORE_SEND/);assert.equal(calls,0);
  await Promise.all([publishApprovedManually(db,input(approved[0]),'editor',manualEnv,transport),publishApprovedManually(db,input(approved[0]),'editor',manualEnv,transport)]);
  await publishApprovedManually(db,input(approved[0]),'editor',manualEnv,transport);
  assert.equal(manualEnv.SHADOW_MODE,'true');assert.equal(manualEnv.AUTO_PUBLISH,'false');
  assert.equal(calls,1);const sent=await db.publication.findUniqueOrThrow({where:{id:approved[0].id}});assert.equal(sent.status,'SENT');assert.equal(sent.telegramMessageId,'123');
  assert.equal(await db.publicationAttempt.count({where:{publicationId:sent.id}}),1);
  const b=await draft();const bp=await approvePublication(db,b.input,'editor',env);let uncertainCalls=0;
  const timeout:typeof fetch=async()=>{uncertainCalls++;throw new Error('timeout');};
  await publishApprovedManually(db,input(bp),'editor',manualEnv,timeout);await publishApprovedManually(db,input(bp),'editor',manualEnv,timeout);assert.equal(uncertainCalls,1);
  assert.equal((await db.publication.findUniqueOrThrow({where:{id:bp.id}})).status,'UNKNOWN');
  const c=await draft();const cp=await approvePublication(db,c.input,'editor',env);await db.newsItem.update({where:{id:c.item.id},data:{title:'changed'}});
  await assert.rejects(publishApprovedManually(db,input(cp),'editor',manualEnv,transport),/APPROVAL_OR_CONTENT_CHANGED/);assert.equal(calls,1);
  const d=await draft([{code:'UNSUPPORTED_OUTPUT'}]);await assert.rejects(approvePublication(db,d.input,'editor',env),/UNRESOLVED_VALIDATION_FAILURE/);
  const hidden=await draft();
  const tampered=await db.newsItem.update({where:{id:hidden.item.id},data:{arabicContent:hidden.item.arabicContent+'\nادعاء غير مسند'}});
  await assert.rejects(approvePublication(db,{...hidden.input,digest:approvalDigest(tampered)},'editor',env),/INCOMPLETE_DRAFT_PROVENANCE/);
  assert.equal(await db.publication.count({where:{newsItemId:hidden.item.id}}),0);
  const failed=await draft();const fp=await approvePublication(db,failed.input,'editor',env);let rejectedCalls=0;
  const rejected:typeof fetch=async()=>{rejectedCalls++;return Response.json({ok:false,error_code:429},{status:429});};
  await publishApprovedManually(db,input(fp),'editor',manualEnv,rejected);await publishApprovedManually(db,input(fp),'editor',manualEnv,rejected);assert.equal(rejectedCalls,1);
  assert.equal((await db.publication.findUniqueOrThrow({where:{id:fp.id}})).status,'FAILED');
  const stopped=await draft();const sp=await approvePublication(db,stopped.input,'editor',env);
  await db.publication.update({where:{id:sp.id},data:{status:'SENDING',attemptCount:1}});
  await publishApprovedManually(db,input(sp),'editor',manualEnv,transport);assert.equal(calls,1);
  const lost=await draft();const lp=await approvePublication(db,lost.input,'editor',env);let transactions=0,lostCalls=0;
  const broken=new Proxy(db,{get(target,key){
   if(key==='$transaction')return (...args:Parameters<typeof db.$transaction>)=>{if(++transactions>=2)throw new Error('SIMULATED_RESULT_PERSISTENCE_FAILURE');return Reflect.apply(target.$transaction,target,args);};
   return Reflect.get(target,key);
  }});
  const accepted:typeof fetch=async()=>{lostCalls++;return Response.json({ok:true,result:{message_id:999,chat:{id:-100123}}});};
  await assert.rejects(publishApprovedManually(broken,input(lp),'editor',manualEnv,accepted),/SIMULATED_RESULT/);
  assert.equal((await db.publication.findUniqueOrThrow({where:{id:lp.id}})).status,'SENDING');
  await publishApprovedManually(db,input(lp),'editor',manualEnv,accepted);assert.equal(lostCalls,1);
  assert.equal((await reconcileDelivery(db,lp.id)).status,'SENT');assert.equal((await db.publication.findUniqueOrThrow({where:{id:lp.id}})).telegramMessageId,'999');assert.equal(lostCalls,1);
  assert.equal((await db.newsItem.findUniqueOrThrow({where:{id:a.item.id}})).status,'PUBLISHED');
  assert.equal(await db.auditLog.count({where:{entityId:sent.id,action:'PUBLICATION_SENT',actor:'editor'}}),1);
  assert.ok(await db.auditLog.count({where:{entityType:'Publication',entityId:sent.id,action:'PUBLICATION_SENT'}}));
 }finally{
  const publications=await db.publication.findMany({where:{newsItemId:{in:ids}}});const pids=publications.map(p=>p.id);
  await db.auditLog.deleteMany({where:{entityType:'Publication',entityId:{in:pids}}});await db.publicationAttempt.deleteMany({where:{publicationId:{in:pids}}});await db.publication.deleteMany({where:{id:{in:pids}}});
  await db.newsEvidence.deleteMany({where:{newsItemId:{in:ids}}});await db.newsItem.deleteMany({where:{id:{in:ids}}});await db.eventRevision.deleteMany({where:{eventId:{in:events}}});await db.canonicalEvent.deleteMany({where:{id:{in:events}}});
  if(sourceId){await db.sourcePost.deleteMany({where:{sourceId}});await db.source.delete({where:{id:sourceId}});}await db.$disconnect();
 }
});
