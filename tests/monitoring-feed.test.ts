import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PrismaClient, ProcessingStatus} from '@prisma/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {monitoringFeed, monitoringCursor, monitoringQuery, monitoringHref, monitoredText, monitoredSource} from '../src/lib/monitoring-feed';
import {allowed, assertRole} from '../src/lib/dashboard-permissions';

test('monitoring follows existing operational-view RBAC and authenticates before reading', () => {
  for (const role of ['ADMIN','SUPER_ADMIN'] as const) assert(allowed(role, '/monitoring'));
  assert(!allowed('EDITOR', '/monitoring'));
  assert.throws(() => assertRole('EDITOR', true), /FORBIDDEN/);
  const page = readFileSync('src/app/monitoring/page.tsx', 'utf8');
  assert(page.indexOf('await requireUser(true)') < page.indexOf('await readDatabase'));
  assert(readFileSync('src/components/dashboard-shell.tsx','utf8').includes("['/monitoring','رصد']"));
});
test('query selects ingestion data only; no pipeline state affects visibility', () => {
  const query = monitoringQuery({});
  assert.deepEqual(query.where, {source: {platform:'TELEGRAM'}});
  assert.equal(query.take, 51);
  assert.deepEqual(query.orderBy,[{ingestedAt:'desc'},{id:'desc'}]);
  assert(!/jobs|evidence|status|publication|newsItem|normalizedContent|metadata|processingResult/i.test(JSON.stringify(query)));
});
test('malformed cursors are harmless; source filters stay parameterized', () => {
  for (const before of ['bad','a'.repeat(513),Buffer.from('["bad-date","x"]').toString('base64url')]) assert.deepEqual(monitoringQuery({before}),monitoringQuery({}));
  assert.equal(monitoringQuery({source:"x' OR true"}).where?.sourceId,"x' OR true");
  assert.equal(monitoringHref('x & y','abc'),'/monitoring?source=x+%26+y&before=abc');
});
test('source identity uses stored values and a stable fallback', () => {
  assert.equal(monitoredSource({id:'a',name:'إرنا العربية',handle:'irna_ar'}),'إرنا العربية — @irna_ar');
  assert.equal(monitoredSource({id:'a',name:'',handle:'@irna_ar'}),'a — @irna_ar');
});
test('empty captions have a placeholder; nonempty original text is unchanged and safely escaped', () => {
  assert.equal(monitoredText(' \n '),'منشور بلا نص');
  const original='  النص\n<script>alert(1)</script>\n';
  assert.equal(monitoredText(original),original);
  assert(renderToStaticMarkup(createElement('div',null,monitoredText(original))).includes('&lt;script&gt;'));
});
test('page has no mutation, processing, provider, publishing or media-fetch dependency', () => {
  const page=readFileSync('src/app/monitoring/page.tsx','utf8');
  const feed=readFileSync('src/lib/monitoring-feed.ts','utf8');
  assert(!/from ['"].*(processing\/|telegram\/|actions|provider)/.test(page+feed));
  assert(!/\.create\(|\.update\(|\.delete\(|\.upsert\(|fetch\(|action=|<img|<video/.test(page+feed));
  assert(page.includes('monitoredText(post.originalContent)'));
});
test('refresh is read-only, visible-tab-only, first-page-only and bounded', () => {
  const refresh=readFileSync('src/components/monitoring-refresh.tsx','utf8');
  assert(refresh.includes('!live || pending'));
  assert(refresh.includes("document.visibilityState === 'visible'"));
  assert(refresh.includes('30000'));
  assert(refresh.includes('clearInterval(timer)'));
  assert(!/fetch\(|action|publish|processPost/.test(refresh));
});
test('real local DB: job-independent lifecycle, original text, all outcomes, stable cursors and indexes', {skip: !process.env.TEST_DATABASE_URL}, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname,'127.0.0.1');
  const db = new PrismaClient({datasourceUrl:url});
  try {
    const source=await db.source.create({data:{platform:'TELEGRAM',name:'المصدر',handle:'monitor_fixture',url:'https://t.me/monitor_fixture'}});
    const make=(id:string,originalContent:string,ingestedAt=new Date('2026-09-23T10:00:00Z')) => db.sourcePost.create({data:{id,sourceId:source.id,sourcePostId:id,sourceUrl:source.url+'/'+id,originalContent,sourcePublishedAt:new Date(0),ingestedAt}});
    const post=await make('monitor_initial','  النص الأصلي\nكما رُصد  ');
    assert.equal(await db.processingJob.count(),0);
    assert.equal((await monitoringFeed(db,{})).items[0].id,post.id);
    for(const status of Object.values(ProcessingStatus)) {
      await db.sourcePost.update({where:{id:post.id},data:{status}});
      assert.equal((await monitoringFeed(db,{})).items[0].originalContent,post.originalContent,status);
    }
    const job=await db.processingJob.create({data:{sourcePostId:post.id,stage:'PROCESS_V1',status:'FAILED',lastError:'AI_SCHEMA_REPAIR_FAILED'}});
    assert.equal((await monitoringFeed(db,{})).items[0].id,post.id);
    await db.processingJob.update({where:{id:job.id},data:{status:'COMPLETED'}});
    const event=await db.canonicalEvent.create({data:{title:'محرر',summary:'fixture',facts:{},revisions:{create:{facts:{},newsItem:{create:{title:'عنوان منشور مختلف',arabicContent:'نص منشور مختلف',status:'PUBLISHED'}}}}},include:{revisions:{include:{newsItem:true}}}});
    await db.newsEvidence.create({data:{newsItemId:event.revisions[0].newsItem!.id,sourcePostId:post.id}});
    assert.equal((await monitoringFeed(db,{})).items[0].originalContent,post.originalContent);
    const empty=await make('monitor_empty','');
    assert.equal(monitoredText((await monitoringFeed(db,{})).items.find(p=>p.id===empty.id)!.originalContent),'منشور بلا نص');
    for(let i=0;i<107;i++) await make('monitor_'+String(i).padStart(3,'0'),'رصد '+i);
    const first=await monitoringFeed(db,{});
    assert.equal(first.items.length,50); assert(first.next);
    assert.deepEqual(first.items.map(p=>p.id),[...first.items.map(p=>p.id)].sort().reverse());
    await make('monitor_new','وافد جديد',new Date('2026-09-23T11:00:00Z'));
    assert.equal((await monitoringFeed(db,{})).items[0].id,'monitor_new');
    const ids=first.items.map(p=>p.id); let cursor: string | null=first.next;
    while(cursor){const next=await monitoringFeed(db,{before:cursor});ids.push(...next.items.map(p=>p.id));cursor=next.next;}
    assert.equal(ids.length,109);assert.equal(new Set(ids).size,109);assert(!ids.includes('monitor_new'));
    assert.equal((await monitoringFeed(db,{source:'missing'})).items.length,0);
    assert.equal((await monitoringFeed(db,{source:source.id})).items.length,50);
    await db.source.update({where:{id:source.id},data:{enabled:false,deletedAt:new Date()}});
    assert.equal((await monitoringFeed(db,{source:source.id})).items.length,50);
    const indices=await db.$queryRaw<{indexname:string}[]>`SELECT indexname FROM pg_indexes WHERE tablename='SourcePost'`;
    assert(indices.some(x=>x.indexname==='SourcePost_ingestedAt_id_idx'));
    assert(indices.some(x=>x.indexname==='SourcePost_sourceId_ingestedAt_id_idx'));
    const q=monitoringQuery({before:monitoringCursor(post)});assert(q.where?.OR);
    assert.equal(await db.publication.count(),0);
  } finally {await db.$disconnect();}
});
