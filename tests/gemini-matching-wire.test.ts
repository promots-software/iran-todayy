import {compactMatcherCandidate} from '../src/lib/processing/canonical-matcher-documents';
/* eslint-disable @typescript-eslint/no-explicit-any -- malformed transport fixtures intentionally vary shape */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {matchCanonicalArticle} from '../src/lib/processing/canonical-matching';
import type {Candidate} from '../src/lib/processing/matcher';
const at=new Date('2026-09-26T16:00:00Z');
const candidates:Candidate[]=Array.from({length:36},(_,i)=>({id:`e${i}`,revisionId:`r${i}`,revision:1,publishedAt:at,published:false,data:{actors:[],action:null,object:null,location:null,eventTime:null,facts:[],summary:'خبر إيران'}}));
async function run(change:(x:any)=>unknown=x=>x,inspect?:(b:any)=>void,finish='STOP',text?:string){
 const p=new GeminiLanguageProvider('offline',async(_u,i)=>{const b=JSON.parse(String(i?.body));inspect?.(b);const input=JSON.parse(b.contents[0].parts[0].text);const output=change({snapshot:input.snapshot,assessmentComplete:true,matches:[]});return Response.json({candidates:[{finishReason:finish,content:{parts:[{text:text??JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}})},()=>{},true);
 return matchCanonicalArticle('خبر إيران',at,candidates,r=>p.canonicalRequest(r,new AbortController().signal));
}
test('36 candidates retain full evidence with constant compact wire schema and complete empty NEW',async()=>{
 assert.equal((await run(x=>x,b=>{const schema=b.generationConfig.responseJsonSchema;assert.equal(schema.properties.matches.type,'array');assert.equal(schema.properties.matches.items.type,'array');assert(!JSON.stringify(schema).includes('prefixItems'));assert(JSON.stringify(schema).length<1000);const input=JSON.parse(b.contents[0].parts[0].text);assert.equal(input.candidates.length,36);assert.equal(input.source,'خبر إيران');assert.deepEqual(input.candidates,candidates.map(compactMatcherCandidate));assert.deepEqual(input.candidates.map((c:any)=>c.id),candidates.map((_,i)=>`c${i}`));assert.match(input.snapshot,/^[a-f0-9]{64}$/);assert.equal(b.generationConfig.maxOutputTokens,4096);assert.deepEqual(b.generationConfig.thinkingConfig,{thinkingBudget:0});assert.match(b.systemInstruction.parts[0].text,/assessing every candidate/);})).classification,'NEW_EVENT');
});
for(const [name,relation,update,conflict,expected] of [['duplicate','S',false,false,'DUPLICATE'],['update','S',true,false,'MATERIAL_UPDATE'],['uncertain','U',false,false,'UNCERTAIN_MATCH'],['conflicting update','S',true,true,'UNCERTAIN_MATCH'],['uncertain update','U',true,false,'UNCERTAIN_MATCH'],['uncertain conflict update','U',true,true,'UNCERTAIN_MATCH']] as const)test(name,async()=>{
 const result=await run(x=>({...x,matches:[['c7',relation,update,conflict,'Exact relevant explanation']]}));assert.equal(result.classification,expected);assert.equal(result.candidate?.id,'e7');assert.equal(result.candidate?.revisionId,'r7');assert.equal(result.rationale,'Exact relevant explanation');assert.equal(result.candidates[0].evidence.materialUpdate,update);assert.equal(result.candidates[0].evidence.conflict,conflict);
});
const bad:Record<string,(x:any)=>unknown>={
 'missing snapshot':x=>{delete x.snapshot;return x;},'invalid snapshot':x=>({...x,snapshot:42}),'mismatched snapshot':x=>({...x,snapshot:'0'.repeat(64)}),
 'incomplete assessment':x=>({...x,assessmentComplete:false}),'missing assessment':x=>{delete x.assessmentComplete;return x;},'string assessment':x=>({...x,assessmentComplete:'true'}),
 'missing matches':x=>{delete x.matches;return x;},'null matches':x=>({...x,matches:null}),'unknown alias':x=>({...x,matches:[['c36','S',false,false,'why']]}),
 'duplicate alias':x=>({...x,matches:[['c0','S',false,false,'why'],['c0','U',false,true,'conflicting duplicate row']]}),
 'wrong relation':x=>({...x,matches:[['DIFFERENT','NEW_EVENT',false,false,'why']]}),'negative row':x=>({...x,matches:[['c0','DIFFERENT_OCCURRENCE',false,false,'why']]}),
 'invalid update flag':x=>({...x,matches:[['c0','S','false',false,'why']]}),'invalid conflict flag':x=>({...x,matches:[['c0','S',true,0,'why']]}),
 'missing rationale':x=>({...x,matches:[['c0','S',false,false]]}),'empty rationale':x=>({...x,matches:[['c0','S',false,false,'']]}),
 'extra row field':x=>({...x,matches:[['c0','S',false,false,'why','extra']]}),'inconsistent final decision':x=>({...x,decision:'DUPLICATE'}),
 'legacy rows':()=>({matches:[{candidateId:'r0',relation:'SAME_OCCURRENCE',materialUpdate:false,conflict:false,rationale:'why'}]}),
 'empty object':()=>({}),'missing output':()=>null,'leading-zero alias':x=>({...x,matches:[['c00','S',false,false,'why']]}),
 'oversized rationale':x=>({...x,matches:[['c0','S',false,false,'a'.repeat(3001)]]})
};
for(const [name,change] of Object.entries(bad))test(`reject ${name}`,async()=>{await assert.rejects(run(change),/INVALID_COMPARISON_SCHEMA|AI_INVALID_SCHEMA/);});
test('truncated JSON fails closed even with STOP',async()=>{await assert.rejects(run(x=>x,undefined,'STOP','{"snapshot":'),/INVALID_COMPARISON_SCHEMA/);});
test('MAX_TOKENS cannot turn partial/empty matches into NEW',async()=>{await assert.rejects(run(x=>x,undefined,'MAX_TOKENS'),/GEMINI_INCOMPLETE/);});
test('multiple reversed relevant rows preserve candidate order and uncertainty',async()=>{const r=await run(x=>({...x,matches:[['c7','S',false,false,'seven'],['c0','S',false,false,'zero']]}));assert.equal(r.classification,'UNCERTAIN_MATCH');assert.deepEqual(r.candidates.map(c=>c.revisionId),['r0','r7']);});
test('24-hour window boundary is unchanged',async()=>{for(const [hours,expected]of [[24,'DUPLICATE'],[24+1/3600,'UNCERTAIN_MATCH']]as const){const old={...candidates[0],publishedAt:new Date(at.getTime()-hours*3600000)};const r=await matchCanonicalArticle('خبر',at,[old],async q=>({snapshot:(q.input as {snapshot:string}).snapshot,assessmentComplete:true,matches:[['c0','S',false,false,'same']]}));assert.equal(r.classification,expected);}});
test('binding changes with source, time, revision, evidence and candidate order',async()=>{const digest=async(source:string,when:Date,cs:Candidate[])=>{let s='';await matchCanonicalArticle(source,when,cs,async q=>{s=(q.input as {snapshot:string}).snapshot;return{snapshot:s,assessmentComplete:true,matches:[]};});return s;};const original=await digest('خبر',at,candidates);for(const v of [await digest('خبر جديد',at,candidates),await digest('خبر',new Date(at.getTime()+1),candidates),await digest('خبر',at,[{...candidates[0],revision:2},...candidates.slice(1)]),await digest('خبر',at,[{...candidates[0],data:{...candidates[0].data,summary:'تغيير'}},...candidates.slice(1)]),await digest('خبر',at,[...candidates].reverse())])assert.notEqual(original,v);});
test('caller mutation cannot change immutable alias map during await',async()=>{const cs=structuredClone(candidates);const r=await matchCanonicalArticle('خبر',at,cs,async q=>{cs[0].revisionId='changed';return{snapshot:(q.input as {snapshot:string}).snapshot,assessmentComplete:true,matches:[['c0','S',false,false,'same']]};});assert.equal(r.candidate?.revisionId,'r0');});
test('no-candidate fast path makes no request',async()=>{assert.equal((await matchCanonicalArticle('خبر',at,[],async()=>{throw Error('REQUEST');})).classification,'NEW_EVENT');});
test('legacy and transactional publication protections remain at the job boundary',()=>{const source=readFileSync('src/lib/processing/canonical-job.ts','utf8');for(const guard of ["before?.legacy&&match.classification==='NEW_EVENT'","pg_advisory_xact_lock","STALE_CLAIM","SOURCE_DISABLED","SOURCE_PROCESSING_MODE_CHANGED","(await snapshot(tx)).key!==before.key","MATCH_SNAPSHOT_CHANGED"])assert(source.includes(guard),guard);});
