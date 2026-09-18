import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
test('dashboard human save, approve and frozen preview for a failed source post, no send',{skip:!process.env.TEST_DATABASE_URL||!process.env.TEST_BASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!,base=process.env.TEST_BASE_URL!;for(const u of [url,base])assert.ok(['localhost','127.0.0.1'].includes(new URL(u).hostname));
 const db=new PrismaClient({datasourceUrl:url});let sourceId='',postId='';const auth='Basic '+Buffer.from(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`).toString('base64');
 const decode=(s:string)=>s.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
 try{
  const src=await db.source.create({data:{platform:'TELEGRAM',handle:randomUUID(),name:'offline editor test',url:'https://t.me/offline'}});sourceId=src.id;
  const post=await db.sourcePost.create({data:{sourceId,sourcePostId:'1',sourceUrl:'https://t.me/offline/1',originalContent:'أكد المتحدث انتهاء الاجتماع.',sourcePublishedAt:new Date(),status:'NEEDS_REVIEW',error:'UNSUPPORTED_OUTPUT',processingResult:{draft:'failed AI output'}}});postId=post.id;
  const route=base+'/posts/'+postId;
  async function page(){const r=await fetch(route,{headers:{authorization:auth}});assert.equal(r.status,200);return r.text();}
  async function form(marker:string){const html=await page();assert.ok(html.includes('UNSUPPORTED_OUTPUT'));const f=[...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(x=>x[0]).find(x=>x.includes(marker));assert.ok(f);const data=new FormData();for(const [tag] of f.matchAll(/<input\b[^>]*>/g)){if(!tag.includes('type="hidden"'))continue;const name=tag.match(/name="([^"]*)"/)?.[1];if(name)data.append(decode(name),decode(tag.match(/value="([^"]*)"/)?.[1]??''));}return data;}
  const save=await form('name="revision"');save.set('title','انتهاء الاجتماع');save.set('body','أكد المتحدث انتهاء الاجتماع.');
  assert.equal((await fetch(route,{method:'POST',headers:{origin:base},body:save})).status,401);
  assert.equal(await db.humanEditorialDraft.count({where:{sourcePostId:postId}}),0);
  const submit=(body:FormData)=>fetch(route,{method:'POST',headers:{authorization:auth,origin:base},body});
  assert.equal((await submit(save)).status,200);
  const d=await db.humanEditorialDraft.findUniqueOrThrow({where:{sourcePostId:postId}});assert.equal(d.status,'DRAFT');
  const approval=await form('name="confirmHuman"');approval.set('note','Synthetic human editor verified source, attribution and terminology.');
  await submit(approval);assert.equal(await db.publication.count({where:{humanDraftId:d.id}}),0);
  approval.set('confirmHuman','on');await submit(approval);
  const p=await db.publication.findFirstOrThrow({where:{humanDraftId:d.id}});assert.equal(p.contentSnapshot,'انتهاء الاجتماع\n\nأكد المتحدث انتهاء الاجتماع.');assert.equal(p.attemptCount,0);
  const html=await page();assert.ok(html.includes('name="confirmSend"'));assert.ok(html.includes('معتمد بشرياً'));assert.ok(html.includes(p.destination));
  assert.equal(await db.publicationAttempt.count({where:{publicationId:p.id}}),0);
  assert.deepEqual(await db.sourcePost.findUniqueOrThrow({where:{id:postId}}),post);
 }finally{
  const drafts=await db.humanEditorialDraft.findMany({where:{sourcePostId:postId}});for(const d of drafts){const ps=await db.publication.findMany({where:{humanDraftId:d.id}});await db.auditLog.deleteMany({where:{entityId:{in:[d.id,...ps.map(p=>p.id)]}}});await db.publication.deleteMany({where:{humanDraftId:d.id}});await db.humanEditorialDraft.delete({where:{id:d.id}});}
  if(postId)await db.sourcePost.delete({where:{id:postId}});if(sourceId)await db.source.delete({where:{id:sourceId}});await db.$disconnect();
 }
});
