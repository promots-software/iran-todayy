import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {newsPage,unresolvedPage,pageNumber,pageHref,pageWindow} from '../src/lib/dashboard-pagination';
import {readEditorialState} from '../src/lib/processing/editorial-eligibility';
import {allowed} from '../src/lib/dashboard-permissions';
test('page input and independent list navigation are bounded and retain other pages',()=>{
 for(const v of [undefined,'-1','0','1.5','Infinity','99999999',['2']])assert.equal(pageNumber(v),1);
 assert.equal(pageNumber('3'),3);assert.equal(pageWindow(999,121).page,3);
 assert.equal(pageHref('/review',{postsPage:'2',newsPage:'3'},'newsPage',4),'/review?postsPage=2&newsPage=4');
});
test('pagination routes retain server-side authentication and ADMIN/EDITOR boundaries',()=>{
 for(const route of ['/review','/approvals','/published','/']){assert(allowed('EDITOR',route));assert(allowed('ADMIN',route));}
 for(const [file,admin]of [['review',false],['approvals',false],['published',false],['filtered',true],['events',true]] as const){const text=readFileSync(`src/app/${file}/page.tsx`,'utf8');assert(text.includes(admin?'await requireUser(true)':'await requireUser()'));if(admin)assert(!allowed('EDITOR','/'+file));assert(text.indexOf('await requireUser(')<text.indexOf('await searchParams'));}
});
test('database pagination: over 100 review/approval rows, pre-limit eligibility, null fallback, ties, holds and independent unresolved pages',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url}),tag='pagination-'+randomUUID(),at=new Date('2090-01-01T00:00:00Z');
 const ids=Array.from({length:370},(_,i)=>`${tag}-${String(i).padStart(4,'0')}`);
 const expectedReady=ids.slice(0,121),expectedReview=ids.slice(121,242);
 try{
  await db.source.create({data:{id:tag,platform:'TELEGRAM',handle:tag,name:'offline',url:'https://t.me/offline'}});
  await db.canonicalEvent.createMany({data:ids.map(id=>({id,title:'offline',summary:'offline',facts:{}}))});
  await db.eventRevision.createMany({data:ids.map(id=>({id,eventId:id,facts:{}}))});
  await db.newsItem.createMany({data:ids.map((id,i)=>({id,eventRevisionId:id,title:'اختبار',createdAt:i<242?at:new Date('2091-01-01T00:00:00Z'),status:i<121?'PENDING_APPROVAL':'NEEDS_REVIEW',validationStatus:'PASSED',error:i>=367?'UNSUPPORTED_OUTPUT':null,validationResult:i===0?{validated:true}:i<121?{editorialEligibility:'READY_TO_PUBLISH',deliveryDecision:'HOLD',validated:true}:{editorialEligibility:'NEEDS_REVIEW'}}))});
  await db.sourcePost.createMany({data:Array.from({length:121},(_,i)=>({id:ids[i],sourceId:tag,sourcePostId:String(i),sourceUrl:'https://t.me/offline/'+i,originalContent:'خبر',sourcePublishedAt:at,ingestedAt:at,status:'NEEDS_REVIEW',error:'UNSUPPORTED_OUTPUT'}))});
  // Snapshot all eligible rows first, then traverse pages. Old fixture rows are
  // included in the same expected sequence; no production database is permitted.
  const allNews=await db.newsItem.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}],include:{humanDraft:true,evidence:{include:{sourcePost:true}}}});
  for(const mode of ['review','approval'] as const){const expected=allNews.filter(n=>{const ready=readEditorialState(n.validationResult,n.status,n.error)==='READY_TO_PUBLISH',media=n.evidence.some(e=>(e.sourcePost.metadata as {hasMedia?:boolean;hasPhoto?:boolean})?.hasMedia===true||(e.sourcePost.metadata as {hasPhoto?:boolean})?.hasPhoto===true);return mode==='approval'?['PENDING_APPROVAL','APPROVED','NEEDS_REVIEW'].includes(n.status)&&!n.error&&['PASSED','NEEDS_REVIEW'].includes(n.validationStatus)&&!media&&(ready||n.status==='APPROVED'):n.status==='NEEDS_REVIEW'&&(!n.humanDraft||n.humanDraft.status==='DRAFT')&&(media||!ready);}).map(n=>n.id);
   const seen:string[]=[];let pages=1;for(let p=1;p<=pages;p++){const result=await newsPage(db,mode,p);pages=result.pages;assert.equal(result.total,expected.length);seen.push(...result.items.map(n=>n.id));}assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,seen.length);for(const id of mode==='approval'?expectedReady:expectedReview)assert(seen.includes(id));
  }
  const seen:string[]=[];let pages=1;for(let p=1;p<=pages;p++){const r=await unresolvedPage(db,p);pages=r.pages;seen.push(...r.items.map(x=>x.id));}assert.equal(new Set(seen).size,seen.length);for(const id of expectedReady)assert(seen.includes(id));
  assert.deepEqual((await newsPage(db,'approval',1)).items.map(x=>x.id),(await newsPage(db,'approval',1)).items.map(x=>x.id));
 }finally{await db.sourcePost.deleteMany({where:{sourceId:tag}});await db.newsItem.deleteMany({where:{id:{in:ids}}});await db.eventRevision.deleteMany({where:{id:{in:ids}}});await db.canonicalEvent.deleteMany({where:{id:{in:ids}}});await db.source.deleteMany({where:{id:tag}});await db.$disconnect();}
});
