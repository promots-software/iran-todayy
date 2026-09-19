import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {saveHumanDraft,approveHumanDraft} from '../src/lib/human-editorial';
import {humanDigest,humanText} from '../src/lib/human-editorial-contract';
import {publishWeb} from '../src/lib/web-publication';
test('local database: media add/change/remove, explicit no-image approval, edit invalidation, immutable sent content and failed AI history',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));const db=new PrismaClient({datasourceUrl:url});
 const tag=randomUUID();
 try{
  await db.appSettings.upsert({where:{id:1},create:{id:1,publishingMode:'REQUIRE_APPROVAL'},update:{}});
  const source=await db.source.create({data:{platform:'TELEGRAM',handle:tag,name:'مصدر الاختبار المحلي',url:'https://t.me/offline'}});
  const post=await db.sourcePost.create({data:{sourceId:source.id,sourcePostId:'1',sourceUrl:'https://t.me/offline/1',sourcePublishedAt:new Date(),originalContent:'قال المتحدث إن الاجتماع انتهى.',status:'NEEDS_REVIEW',error:'UNSUPPORTED_OUTPUT',processingResult:{aiOutput:'failed'},metadata:{hasPhoto:true}}});
  const input={kind:'post' as const,id:post.id,title:'انتهاء الاجتماع',body:'قال المتحدث إن الاجتماع انتهى.',revision:0};
  const d=await saveHumanDraft(db,input,'user:test');
  const approve=(id:string,digest:string)=>approveHumanDraft(db,{id,digest,confirmed:true,note:'راجعت النص والدليل واتخذت قرار الصورة صراحة.'},'user:test',{},'WEB');
  await assert.rejects(approve(d.id,humanDigest(d)),/SOURCE_MEDIA_DECISION_REQUIRED/);
  const image=await db.publicationImage.create({data:{bytes:Buffer.from('offline'),mime:'image/png',digest:'test',createdBy:'user:test'}});
  const withImage=await saveHumanDraft(db,{...input,revision:1,publicationImageId:image.id,mediaDecision:true},'user:test');const p=await approve(d.id,humanDigest(withImage));assert.equal(p.publicationImageId,image.id);
  const noImage=await saveHumanDraft(db,{...input,revision:2,publicationImageId:null,mediaDecision:true},'user:test');assert.equal(noImage.approvedAt,null);assert.equal((await db.publication.findUniqueOrThrow({where:{id:p.id}})).status,'CANCELLED');assert.equal((await db.publication.findUniqueOrThrow({where:{id:p.id}})).publicationImageId,image.id);
  const frozen=await approve(d.id,humanDigest(noImage));assert.equal(frozen.destination,'WEB');assert.equal(frozen.publicationImageId,null);
  await Promise.all([1,2,3].map(()=>publishWeb(db,{id:frozen.id,digest:frozen.idempotencyKey,confirmed:true},'user:test')));
  const sent=await db.publication.findUniqueOrThrow({where:{id:frozen.id}});assert.equal(sent.contentSnapshot,humanText(noImage));assert.equal(sent.status,'SENT');assert.equal(sent.telegramMessageId,null);assert.equal(await db.publicationAttempt.count({where:{publicationId:sent.id}}),1);
  await assert.rejects(saveHumanDraft(db,{...input,revision:3,title:'عنوان آخر'},'user:test'),/PUBLICATION_LOCKED/);
  assert.deepEqual(await db.sourcePost.findUniqueOrThrow({where:{id:post.id}}),post);
  assert.equal(await db.auditLog.count({where:{actor:'user:test',action:'WEB_PUBLICATION_PUBLISHED',entityId:sent.id}}),1);
 }finally{await db.$disconnect();}
});
