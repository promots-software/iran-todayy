import test from 'node:test';
import assert from 'node:assert/strict';
import {matchEvent} from '../src/lib/processing/matcher';
import {cleanCases} from './fixtures/newsroom';
test('identical comparison inputs reuse one answer without hiding multiple event ambiguity',async()=>{
 const data=cleanCases()[0].u.event,now=new Date();let calls=0;
 const result=await matchEvent(data,now,['a','b'].map(id=>({id,revisionId:id,revision:1,publishedAt:now,published:false,data})),{
  id:'offline',live:false,understand:async()=>null,draft:async()=>null,
  compare:async()=>{calls++;return {relation:'SAME',rationale:'مطابقة اختبار',newFactIds:[],conflictingFactIds:[]};}
 },new AbortController().signal);
 assert.equal(calls,1);assert.equal(result.classification,'UNCERTAIN_MATCH');assert.equal(result.candidates.length,2);
});
