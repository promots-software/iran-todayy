import {formatTelegram} from '../src/lib/telegram/format';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {saveHumanDraft,approveHumanDraft} from '../src/lib/human-editorial';
import {humanDigest,humanText} from '../src/lib/human-editorial-contract';
import {publishApprovedManually,publishOne} from '../src/lib/telegram/publisher';
const env={TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123',TELEGRAM_MANUAL_PUBLISH_ENABLED:'true',TELEGRAM_PUBLISH_ENABLED:'false',SHADOW_MODE:'true',AUTO_PUBLISH:'false',REQUIRE_APPROVAL:'true'};
test('human revisions preserve failed AI, revoke approval, freeze exact text and send once',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
 const db=new PrismaClient({datasourceUrl:url});let sourceId='',postId='',draftId='';const pubIds:string[]=[];
 try{
  await db.appSettings.upsert({where:{id:1},create:{id:1,publishingMode:'REQUIRE_APPROVAL'},update:{publishingMode:'REQUIRE_APPROVAL'}});
  const source=await db.source.create({data:{platform:'TELEGRAM',handle:randomUUID(),name:'offline',url:'https://t.me/offline'}});sourceId=source.id;
  const post=await db.sourcePost.create({data:{sourceId,sourcePostId:'1',sourceUrl:'https://t.me/offline/1',originalContent:'قال المتحدث إن الاجتماع انتهى.',sourcePublishedAt:new Date(),status:'NEEDS_REVIEW',error:'UNSUPPORTED_OUTPUT',rejectionReason:'AMBIGUOUS_EVIDENCE_CONTEXT',processingResult:{aiOutput:'failed original AI text',errors:['UNSUPPORTED_OUTPUT']}}});postId=post.id;
  const input={kind:'post' as const,id:post.id,revision:0,title:'قال المتحدث إن الاجتماع انتهى.',body:'قال المتحدث إن الاجتماع انتهى.'};
  await assert.rejects(saveHumanDraft(db,input,''),/AUTHENTICATION/);
  const [d,duplicate]=await Promise.all([saveHumanDraft(db,input,'editor'),saveHumanDraft(db,input,'editor')]);draftId=d.id;assert.equal(d.id,duplicate.id);assert.equal(d.revision,1);
  assert.equal(d.body,'');assert.equal(humanText(d),input.title);
  assert.equal((await saveHumanDraft(db,{...input,revision:1,body:''},'editor')).revision,1);
  const approve=(id:string,digest:string)=>approveHumanDraft(db,{id,digest,confirmed:true,note:'Human editor checked the original source, attribution and language.'},'editor',env);
  await assert.rejects(approveHumanDraft(db,{id:d.id,digest:humanDigest(d),confirmed:false,note:'No confirmation'},'editor',env),/HUMAN_RESPONSIBILITY/);
  const [p,p2]=await Promise.all([approve(d.id,humanDigest(d)),approve(d.id,humanDigest(d))]);pubIds.push(p.id);assert.equal(p.id,p2.id);
  assert.equal(p.contentSnapshot,humanText(d));assert.equal(p.newsItemId,null);assert.deepEqual(p.telegramFormatSnapshot,formatTelegram(d.title,d.body));
  await assert.rejects(publishOne(db,p.id,{...env,SHADOW_MODE:'false',TELEGRAM_PUBLISH_ENABLED:'true'},async()=>{throw Error('MUST_NOT_CALL');}),/HUMAN_PUBLICATION_MANUAL_ONLY/);
  const revised=await saveHumanDraft(db,{...input,revision:1,title:'المتحدث يؤكد انتهاء الاجتماع'},'editor');
  assert.equal(revised.status,'DRAFT');assert.equal(revised.approvedAt,null);assert.equal(revised.approvedBy,null);
  assert.equal((await db.publication.findUniqueOrThrow({where:{id:p.id}})).status,'CANCELLED');
  assert.equal((await db.publication.findUniqueOrThrow({where:{id:p.id}})).contentSnapshot,humanText(d));assert.deepEqual((await db.publication.findUniqueOrThrow({where:{id:p.id}})).telegramFormatSnapshot,p.telegramFormatSnapshot);
  await assert.rejects(approve(d.id,humanDigest(d)),/STALE/);
  await assert.rejects(saveHumanDraft(db,{...input,revision:1,title:'عنوان قديم'},'editor'),/STALE/);
  const next=await approve(revised.id,humanDigest(revised));pubIds.push(next.id);assert.notEqual(next.id,p.id);
  let calls=0;const transport:typeof fetch=async(_url,options)=>{calls++;assert.equal(JSON.parse(String(options?.body)).text,formatTelegram(revised.title,revised.body).text);assert.equal(JSON.parse(String(options?.body)).parse_mode,'HTML');return Response.json({ok:true,result:{message_id:881,chat:{id:-100123}}});};
  const send=(p:typeof next)=>publishApprovedManually(db,{publicationId:p.id,digest:p.idempotencyKey,destination:p.destination,confirmed:true},'editor',env,transport);
  await send(p);assert.equal(calls,0);
  await Promise.all([send(next),send(next)]);await send(next);assert.equal(calls,1);
  const sent=await db.publication.findUniqueOrThrow({where:{id:next.id}});assert.equal(sent.status,'SENT');assert.equal(sent.telegramMessageId,'881');assert.equal(sent.contentSnapshot,humanText(revised));
  assert.equal((await db.humanEditorialDraft.findUniqueOrThrow({where:{id:d.id}})).status,'PUBLISHED');
  await assert.rejects(saveHumanDraft(db,{...input,revision:2,title:'تغيير بعد الإرسال'},'editor'),/PUBLICATION_LOCKED/);
  assert.deepEqual(await db.sourcePost.findUniqueOrThrow({where:{id:post.id}}),post);
  assert.equal((d.originalSnapshot as {error:string}).error,'UNSUPPORTED_OUTPUT');
  assert.equal(await db.publicationAttempt.count({where:{publicationId:next.id}}),1);
  for(const action of ['HUMAN_EDIT_APPROVED','PUBLICATION_SEND_STARTED','PUBLICATION_SENT'])assert.equal(await db.auditLog.count({where:{entityId:next.id,action,actor:'editor'}}),1);
  assert.equal(await db.auditLog.count({where:{entityId:p.id,action:'HUMAN_APPROVAL_INVALIDATED'}}),1);
 }finally{
  if(draftId){const pubs=await db.publication.findMany({where:{humanDraftId:draftId}});pubIds.push(...pubs.map(p=>p.id));await db.publicationAttempt.deleteMany({where:{publicationId:{in:pubIds}}});await db.publication.deleteMany({where:{humanDraftId:draftId}});await db.humanEditorialDraft.delete({where:{id:draftId}});}
  await db.auditLog.deleteMany({where:{entityId:{in:[draftId,...pubIds]}}});if(postId)await db.sourcePost.delete({where:{id:postId}});if(sourceId)await db.source.delete({where:{id:sourceId}});await db.$disconnect();
 }
});

test('failed news keeps AI text and validation; edit/send race locks the claimed human version',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));const db=new PrismaClient({datasourceUrl:url});let sid='',pid='',eid='',nid='',did='';
 try{
  const source=await db.source.create({data:{platform:'TELEGRAM',handle:randomUUID(),name:'offline',url:'https://t.me/offline'}});sid=source.id;
  const post=await db.sourcePost.create({data:{sourceId:sid,sourcePostId:'1',sourceUrl:'https://t.me/offline/1',originalContent:'أعلن المتحدث انتهاء الاجتماع.',sourcePublishedAt:new Date(),status:'NEEDS_REVIEW'}});pid=post.id;
  const e=await db.canonicalEvent.create({data:{title:'AI original',summary:'failed AI',facts:{},revisions:{create:{facts:{}}}},include:{revisions:true}});eid=e.id;
  const item=await db.newsItem.create({data:{eventRevisionId:e.revisions[0].id,title:'Original failed AI title',arabicContent:'Original failed output',status:'NEEDS_REVIEW',validationStatus:'FAILED',validationResult:{review:[{code:'UNSUPPORTED_OUTPUT'}]},error:'UNSUPPORTED_OUTPUT',evidence:{create:{sourcePostId:pid}}}});nid=item.id;
  const d=await saveHumanDraft(db,{kind:'news',id:nid,revision:0,title:'انتهاء الاجتماع',body:'أعلن المتحدث انتهاء الاجتماع.'},'editor');did=d.id;
  const {approvePublication,approvalDigest}=await import('../src/lib/telegram/publisher');
  await assert.rejects(approvePublication(db,{newsItemId:nid,digest:approvalDigest(item),resolutions:[]},'editor',env),/HUMAN_DRAFT_REQUIRES_HUMAN_APPROVAL/);
  const p=await approveHumanDraft(db,{id:d.id,digest:humanDigest(d),confirmed:true,note:'Reviewed evidence and replaced failed AI wording with human text.'},'editor',env);
  let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>{release=r});const started=new Promise<void>(r=>{entered=r});
  const sending=publishApprovedManually(db,{publicationId:p.id,digest:p.idempotencyKey,destination:p.destination,confirmed:true},'editor',env,async()=>{entered();await waiting;return Response.json({ok:true,result:{message_id:882,chat:{id:-100123}}});});
  await started;
  try{await assert.rejects(saveHumanDraft(db,{kind:'news',id:nid,revision:1,title:'عنوان آخر',body:'نص جديد.'},'editor'),/PUBLICATION_LOCKED/);}finally{release();}
  assert.equal((await sending).status,'SENT');
  assert.deepEqual(await db.newsItem.findUniqueOrThrow({where:{id:nid}}),item);
 }finally{
  const pubs=did?await db.publication.findMany({where:{humanDraftId:did}}):[];const ids=pubs.map(p=>p.id);await db.auditLog.deleteMany({where:{entityId:{in:[did,...ids]}}});await db.publicationAttempt.deleteMany({where:{publicationId:{in:ids}}});await db.publication.deleteMany({where:{id:{in:ids}}});if(did)await db.humanEditorialDraft.delete({where:{id:did}});if(nid){await db.newsEvidence.deleteMany({where:{newsItemId:nid}});await db.newsItem.delete({where:{id:nid}});}if(eid){await db.eventRevision.deleteMany({where:{eventId:eid}});await db.canonicalEvent.delete({where:{id:eid}});}if(pid)await db.sourcePost.delete({where:{id:pid}});if(sid)await db.source.delete({where:{id:sid}});await db.$disconnect();
 }
});
