import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {runCanonicalFlow,validateCanonicalCheck,assertCanonicalApproval,canonicalDigest,type CanonicalRequest,type CanonicalArticle} from '../src/lib/processing/canonical-flow';import {editorialContract,EDITORIAL_CONTRACT_SHA256} from '../src/lib/processing/editorial-contract';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/canonical-quality/eleven.json',import.meta.url),'utf8')) as {post:string;source:string;cycles:{article:CanonicalArticle;check:unknown}[];audit:{related:boolean;sections:number[];quote?:string;why:string}}[];
function check(sections:number[]=[],quote:string|null=null,why=''){return {sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:sections.includes(i+1)?'FAIL':'PASS',defects:sections.includes(i+1)?[{defect:why,correction:'Remove only the diagnosed unsupported assertion; preserve source meaning.',sourceQuote:null,articleQuote:quote}]:[]}]))};}
// Independent labels below are an offline oracle. These tests do NOT claim to
// measure revised Gemini semantics; the authorized fresh live cohort does that.
for(const f of fixtures)test('frozen eleven expected-diagnosis routing: '+f.post,async()=>{
 const seen:CanonicalRequest[]=[];const article=f.cycles.at(-1)?.article;const result=await runCanonicalFlow(f.source,async r=>{seen.push(r);if(r.stage==='canonical_intake')return {iranRelated:f.audit.related,rationale:f.audit.why};if(r.stage==='canonical_generate'||r.stage==='canonical_correct')return article;return check(f.audit.sections,f.audit.quote??null,f.audit.why);});
 assert.equal(result.status,!f.audit.related?'FILTERED':f.audit.sections.length?'NEEDS_REVIEW':'APPROVED');
 const repairs=seen.filter(r=>r.stage==='canonical_correct');assert.equal(repairs.length,f.audit.related&&f.audit.sections.length?2:0);
 for(const r of seen.filter(r=>r.stage!=='canonical_intake')){assert.ok(r.instructions.includes(editorialContract));assert.deepEqual((r.input as {frozenSource:{text:string}}).frozenSource,{text:f.source});}
 for(const r of repairs)assert.deepEqual((r.input as {failures:{section:number}[]}).failures.map(d=>d.section),f.audit.sections);
});
test('imaginary urgent defect cannot authorize correction; genuine missing source quote also rejected',()=>{
 const f=fixtures.find(x=>x.post==='mayadeenchannel/80186')!,article=f.cycles[0].article;
 assert.throws(()=>validateCanonicalCheck(check([2],'عاجل','Invented marker'),f.source,article),/CANONICAL_CHECK_INVALID/);
 const omitted=check([40],null,'omitted');omitted.sections['40'].defects[0].sourceQuote='nonexistent' as never;
 assert.throws(()=>validateCanonicalCheck(omitted,f.source,article),/CANONICAL_CHECK_INVALID/);
});
test('exact quotations ground diagnostics without literal-matching paraphrases or adding another editorial stage',async()=>{
 const source='افتتحت إيران مكتبة في طهران.',article={title:'إيران الآن | افتتاح مكتبة في طهران',body:'شهدت طهران افتتاح مكتبة.'};const seen:CanonicalRequest[]=[];
 const result=await runCanonicalFlow(source,async r=>{seen.push(r);if(r.stage==='canonical_intake')return {iranRelated:true,rationale:'source event'};if(r.stage==='canonical_generate')return article;return check();});assert.equal(result.status,'APPROVED');assert.equal(seen.length,3);assertCanonicalApproval(result,source,article);
 assert.ok(seen[0].instructions.includes('never remembered biography'));assert.ok(seen[1].instructions.includes('No outside knowledge'));assert.ok(seen[2].instructions.includes('ONE news item'));assert.ok(seen[2].instructions.includes('Never invent a quote or a defect'));
});
test('historical v1 frozen approval stays immutable; v2 cannot omit diagnostic quotes',()=>{
 const f=fixtures.find(x=>x.post==='khabarfouri/566115')!;
 assertCanonicalApproval({version:'canonical-forty-v1',contractHash:EDITORIAL_CONTRACT_SHA256,sourceHash:canonicalDigest(f.source),articleHash:canonicalDigest(f.cycles.at(-1)!.article),status:'APPROVED',cycles:f.cycles as never},f.source,f.cycles.at(-1)!.article);
 assert.throws(()=>validateCanonicalCheck(f.cycles[0].check,f.source,f.cycles[0].article),/CANONICAL_CHECK_INVALID/);
});
