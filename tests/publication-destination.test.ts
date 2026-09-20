import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {saveHumanDraft,approveHumanDraft,cancelUnsentHumanPublication} from '../src/lib/human-editorial';
import {humanDigest,humanPublicationDigest,matchesHumanPublication} from '../src/lib/human-editorial-contract';
const env={TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123'};
test('destination keys differ while legacy frozen approval stays valid',()=>{
 const d={id:'d',title:'عنوان الخبر',body:'',revision:2,originalSnapshot:{}};
 assert.notEqual(humanPublicationDigest(d,'WEB'),humanPublicationDigest(d,'-100123'));
 assert(matchesHumanPublication(d,{idempotencyKey:humanDigest(d),destination:'WEB'}));
 assert(!matchesHumanPublication(d,{idempotencyKey:humanPublicationDigest(d,'WEB'),destination:'-100123'}));
});
test('both approval forms require explicit destination; server does not default WEB',()=>{
 const actions=readFileSync('src/app/actions.ts','utf8');assert.equal((actions.match(/z.enum\(\['WEB','TELEGRAM'\]\).parse\(form.get\('target'\)\)/g)||[]).length,2);
 for(const f of ['human-editor','publication-approval'])assert(readFileSync(`src/components/${f}.tsx`,'utf8').includes('<ApprovalDestination/>'));
 const selector=readFileSync('src/components/approval-destination.tsx','utf8');assert(selector.includes('required defaultValue=""'));assert(selector.includes('Telegram — Iran Today'));
});
test('withdraw unsent WEB approval preserves revision and history; Telegram needs new confirmation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));const db=new PrismaClient({datasourceUrl:url});let sid='',pid='',did='';
 try{
  await db.appSettings.upsert({where:{id:1},create:{id:1,publishingMode:'REQUIRE_APPROVAL'},update:{publishingMode:'REQUIRE_APPROVAL'}});
  const source=await db.source.create({data:{platform:'TELEGRAM',handle:randomUUID(),name:'offline',url:'https://t.me/offline'}});sid=source.id;
  const post=await db.sourcePost.create({data:{sourceId:sid,sourcePostId:'1',sourceUrl:'https://t.me/offline/1',originalContent:'أعلن المتحدث انتهاء الاجتماع.',sourcePublishedAt:new Date(),status:'NEEDS_REVIEW',error:'UNSUPPORTED_OUTPUT'}});pid=post.id;
  const d=await saveHumanDraft(db,{kind:'post',id:pid,revision:0,title:'أعلن المتحدث انتهاء الاجتماع.',body:'',mediaDecision:true},'editor');did=d.id;
  const input={id:did,digest:humanDigest(d),confirmed:true,note:'راجع المحرر المصدر والنص واختار وجهة الاعتماد صراحة.'};
  const web=await approveHumanDraft(db,input,'editor',env,'WEB');
  await assert.rejects(approveHumanDraft(db,input,'editor',env,'TELEGRAM'),/DESTINATION_LOCKED/);
  await assert.rejects(cancelUnsentHumanPublication(db,{id:web.id,digest:web.idempotencyKey,confirmed:false},'editor'),/CONFIRMATION/);
  await cancelUnsentHumanPublication(db,{id:web.id,digest:web.idempotencyKey,confirmed:true},'editor');
  const old=await db.publication.findUniqueOrThrow({where:{id:web.id}});assert.equal(old.destination,'WEB');assert.equal(old.contentSnapshot,web.contentSnapshot);assert.equal(old.idempotencyKey,web.idempotencyKey);assert.equal(old.status,'CANCELLED');
  const pending=await db.humanEditorialDraft.findUniqueOrThrow({where:{id:did}});for(const key of ['title','body','revision','originalSnapshot','publicationImageId','mediaDecisionAt'] as const)assert.deepEqual(pending[key],d[key]);assert.equal(pending.status,'DRAFT');assert.equal(pending.approvedAt,null);
  await assert.rejects(approveHumanDraft(db,{...input,confirmed:false},'editor',env,'TELEGRAM'),/RESPONSIBILITY/);
  const [p,repeat]=await Promise.all([approveHumanDraft(db,input,'editor',env,'TELEGRAM'),approveHumanDraft(db,input,'editor',env,'TELEGRAM')]);assert.equal(p.id,repeat.id);assert.notEqual(p.id,web.id);assert.equal(p.destination,env.TELEGRAM_CHAT_ID);assert.equal(p.contentSnapshot,web.contentSnapshot);assert.equal(p.attemptCount,0);
  await db.publication.update({where:{id:p.id},data:{status:'SENDING',attemptCount:1}});
  await assert.rejects(cancelUnsentHumanPublication(db,{id:p.id,digest:p.idempotencyKey,confirmed:true},'editor'),/LOCKED/);
  assert.equal(await db.publicationAttempt.count({where:{publication:{humanDraftId:did}}}),0);
  assert.deepEqual(await db.sourcePost.findUniqueOrThrow({where:{id:pid}}),post);
 }finally{const pubs=did?await db.publication.findMany({where:{humanDraftId:did}}):[];await db.auditLog.deleteMany({where:{entityId:{in:[did,...pubs.map(p=>p.id)]}}});await db.publication.deleteMany({where:{humanDraftId:did||'none'}});if(did)await db.humanEditorialDraft.delete({where:{id:did}});if(pid)await db.sourcePost.delete({where:{id:pid}});if(sid)await db.source.delete({where:{id:sid}});await db.$disconnect();}
});
