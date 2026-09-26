import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCanonicalArticle} from '../src/lib/processing/canonical-matching';
import type {Candidate} from '../src/lib/processing/matcher';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {runCanonicalFlow} from '../src/lib/processing/canonical-flow';
import {editorialContract} from '../src/lib/processing/editorial-contract';
const candidate:Candidate={id:'e1',revisionId:'r1',revision:1,publishedAt:new Date(),published:true,data:{actors:[],action:null,object:null,location:null,eventTime:null,facts:[],summary:'خبر'}};
for(const [name,relation,materialUpdate,conflict,expected] of [
 ['same event repetition','SAME_OCCURRENCE',false,false,'DUPLICATE'],
 ['material update','SAME_OCCURRENCE',true,false,'MATERIAL_UPDATE'],
 ['similar topic different event','DIFFERENT_OCCURRENCE',false,false,'NEW_EVENT'],
 ['ambiguous','UNCERTAIN',false,false,'UNCERTAIN_MATCH'],
 ['conflicting update','SAME_OCCURRENCE',true,true,'UNCERTAIN_MATCH']
] as const)test(name,async()=>{const result=await matchCanonicalArticle('خبر إيران',new Date(),[candidate],async()=>({matches:{r1:{relation,materialUpdate,conflict,rationale:name}}}));assert.equal(result.classification,expected);});

test('unknown/missing candidate keys fail and multiple matches remain uncertain',async()=>{
 await assert.rejects(matchCanonicalArticle('خبر',new Date(),[candidate],async()=>({matches:{}})),/INVALID_COMPARISON_SCHEMA/);
 const other={...candidate,id:'e2',revisionId:'r2'};const row={relation:'SAME_OCCURRENCE',materialUpdate:false,conflict:false,rationale:'same'};
 assert.equal((await matchCanonicalArticle('خبر',new Date(),[candidate,other],async()=>({matches:{r1:row,r2:row}}))).classification,'UNCERTAIN_MATCH');
});

test('native Gemini adapter uses complete canonical contract and logs each mocked request',async()=>{
 const calls:{stage:string;system:string;input:unknown;max:number}[]=[],usage:unknown[]=[];
 const provider=new GeminiLanguageProvider('offline-not-a-real-key',async(_url,init)=>{
  const body=JSON.parse(String(init?.body));const system=body.systemInstruction.parts[0].text;const input=JSON.parse(body.contents[0].parts[0].text);
  const stage=calls.length===0?'intake':calls.length===1?'generate':'check';calls.push({stage,system,input,max:body.generationConfig.maxOutputTokens});
  const output=stage==='intake'?{iranRelated:true,rationale:'طهران'}:stage==='generate'?{title:'إيران الآن | افتتاح مكتبة',body:'افتتحت مكتبة في طهران.'}:{sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:'PASS',defects:[]}]))};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:50,thoughtsTokenCount:0}});
 },u=>{usage.push(u);},true);
 const result=await runCanonicalFlow('افتتحت مكتبة في طهران.',r=>provider.canonicalRequest(r,AbortSignal.timeout(5000)));
 assert.equal(result.status,'APPROVED');assert.equal(calls.length,3);assert.equal(usage.length,3);
 for(const c of calls.slice(1)){assert.ok(c.system.includes(editorialContract));assert.equal(c.max,4096);}
 assert.deepEqual((usage as {stage:string}[]).map(u=>u.stage),['iran_today_canonical_intake','iran_today_canonical_generate','iran_today_canonical_check']);
});
