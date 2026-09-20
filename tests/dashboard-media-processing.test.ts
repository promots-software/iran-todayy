import test from 'node:test';
import {newsroom} from './fixtures/newsroom';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {fixture,fixtureProvider,official} from './fixtures/processing';
import {buildAtoms,renderSelection} from '../src/lib/processing/constrained-rewrite';
test('source attachment remains reference-only and does not block validated text-only readiness',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url});
 try{for(const hasMedia of [false,true]){
 const tag=randomUUID(),text='أعلن المجلس في طهران افتتاح مدرسة جديدة.',f={...fixture(tag,text),content:text,understanding:newsroom(text,[text])};f.understanding.event.action!.key=tag;f.understanding.event.facts[0].key=tag;
 const provider=Object.assign(fixtureProvider([f]),{constrainedRewrite:true});let drafts=0;provider.compare=async()=>({relation:'DIFFERENT',rationale:'حدث اختبار مستقل',newFactIds:[],conflictingFactIds:[]});
 provider.draft=async()=>{drafts++;return renderSelection({titleAtomId:f.understanding.event.facts[0].id,bodyAtomIds:f.understanding.event.facts.map(x=>x.id)},buildAtoms(f.content,f.understanding));};
 const source=await db.source.create({data:{platform:'TELEGRAM',handle:tag,name:'اختبار وسائط محلي',url:'https://t.me/offline',editorialProfile:official}});
 const p=await ingest(db,source.id,{externalId:'1',content:f.content,publishedAt:new Date(),url:source.url+'/1',metadata:{hasMedia,hasPhoto:hasMedia}},true);
 const others=await db.processingJob.findMany({where:{sourcePostId:{not:p.id}},select:{sourcePostId:true}});
 const job=await claimJob(db,'offline-media',new Date(),true,others.map(x=>x.sourcePostId));assert(job);
 const out=await processJob(db,job,provider,new AbortController().signal);assert.equal('error' in out,false);assert.equal(drafts,1);
 const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:p.id}}}});
 assert.equal(item.needsReviewReasons.some(x=>x.includes('SOURCE_MEDIA_DECISION_REQUIRED')),false);assert.equal((item.validationResult as {editorialEligibility:string}).editorialEligibility,'READY_TO_PUBLISH');assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:p.id}})).originalContent,f.content);assert.equal(item.status,'PENDING_APPROVAL');assert.equal(await db.publication.count({where:{newsItemId:item.id}}),0);
 }}finally{await db.$disconnect();}
});
