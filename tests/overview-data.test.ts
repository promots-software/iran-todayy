import test from 'node:test';
import assert from 'node:assert/strict';
import type {PrismaClient} from '@prisma/client';
import {overviewData,overviewPredicates} from '../src/lib/overview-data';

test('Overview uses Beirut calendar dates, actual sends, and includes disabled configured sources',()=>{
 const summer=overviewPredicates(new Date('2026-09-28T00:30:00Z'));
 assert.equal(summer.published.sentAt.gte.toISOString(),'2026-09-27T21:00:00.000Z');
 assert.equal(overviewPredicates(new Date('2026-01-15T22:30:00Z')).published.sentAt.gte.toISOString(),'2026-01-15T22:00:00.000Z');
 assert.deepEqual(summer.sources,{deletedAt:null});assert.equal(summer.published.status,'SENT');
 assert.deepEqual(summer.duplicates.ingestedAt,summer.published.sentAt);
 assert.equal(summer.duplicates.status,'DUPLICATE');
});
test('Overview union counts rejection/unrelated once and includes human-rejected news without its source posts',()=>{
 const w=overviewPredicates(new Date('2026-09-28T12:00:00Z'));
 assert.deepEqual(w.unrelatedRejected.OR,[{status:'REJECTED'},{status:'FILTERED',rejectionReason:{in:['UNRELATED_TO_IRAN','UNRELATED']}}]);
 assert.deepEqual(w.unrelatedRejected.evidence,{none:{newsItem:w.rejectedNews}});
 assert.equal(w.rejectedNews.status,'REJECTED');assert.deepEqual(w.rejectedNews.createdAt,w.duplicates.ingestedAt);
});
test('Overview performs only parallel count aggregates and returns honest zero values',async()=>{
 const calls:string[]=[];let release!:()=>void;const gate=new Promise<void>(r=>{release=r});
 const count=(name:string,n:number)=>async()=>{calls.push(name);await gate;return n};
 const db={source:{count:count('source',7)},publication:{count:count('publication',0)},sourcePost:{count:count('sourcePost',0)},newsItem:{count:count('newsItem',2)}} as unknown as PrismaClient;
 const pending=overviewData(db);assert.deepEqual(calls,['source','publication','sourcePost','sourcePost','newsItem']);release();
 assert.deepEqual(await pending,{sources:7,published:0,duplicates:0,unrelatedRejected:2});
});
