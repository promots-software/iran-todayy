import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import {runCanonicalFlow,assertCanonicalApproval,type CanonicalRequest} from '../src/lib/processing/canonical-flow';import {editorialContract} from '../src/lib/processing/editorial-contract';
const source='أكدت وزارة الخارجية الإيرانية الموافقة على بدء المحادثات يوم الخميس.';
const cases=[
 ['harmless minor difference','أعلنت الخارجية الإيرانية الموافقة على بدء المحادثات الخميس.',false],
 ['secondary omission','أكدت وزارة الخارجية الإيرانية الموافقة على بدء المحادثات.',false],
 ['journalistic paraphrase','الخارجية الإيرانية تؤكد قبول انطلاق المحادثات يوم الخميس.',false],
 ['minor inference preserves core','أكدت الخارجية الإيرانية الموافقة على بدء المحادثات الخميس في إطار الحوار.',false],
 ['confirmation reversed to denial','نفت وزارة الخارجية الإيرانية الموافقة على بدء المحادثات يوم الخميس.',true],
 ['central speaker reversal','أكدت وزارة الخارجية الأمريكية الموافقة على بدء المحادثات يوم الخميس.',true],
 ['invented central event','وقعت إيران اتفاقاً نهائياً لإنهاء المحادثات يوم الخميس.',true],
 ['central position reversed','أكدت وزارة الخارجية الإيرانية رفض بدء المحادثات يوم الخميس.',true],
] as const;
// Explicit offline semantic oracles verify routing, not Gemini detection. The
// authorized natural cohort independently measures the real model decisions.
for(const [name,body,block] of cases)test('owner publication semantics: '+name,async()=>{
 const article={title:'إيران الآن | موقف من المحادثات',body};const seen:CanonicalRequest[]=[];
 const receipt={sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:block&&i===39?'FAIL':'PASS',defects:block&&i===39?[{defect:'Central event/speaker/position differs from the confirmed agreement in SOURCE.',correction:'Restore the confirmed Iranian agreement to begin talks.',sourceQuote:source,articleQuote:body}]:[]}]))};
 const result=await runCanonicalFlow(source,async r=>{seen.push(r);if(r.stage==='canonical_intake')return {iranRelated:true,rationale:'Iranian foreign ministry'};if(r.stage==='canonical_generate'||r.stage==='canonical_correct')return article;return receipt;});
 assert.equal(result.status,block?'NEEDS_REVIEW':'APPROVED');assert.equal(seen.filter(r=>r.stage==='canonical_correct').length,block?2:0);assert.equal(seen.filter(r=>r.stage==='canonical_check').length,block?3:1);
 if(!block)assertCanonicalApproval(result,source,article);
 for(const r of seen.filter(r=>r.stage!=='canonical_intake'))assert.ok(r.instructions.includes(editorialContract));
 const instruction=seen.find(r=>r.stage==='canonical_check')!.instructions;
 for(const phrase of ['DEFAULT = PASS','small/non-core discrepancy','non-central factual discrepancies alone MUST PASS','confirmation versus denial','materially different central actor or speaker','central event invented or removed','support versus opposition','WHY THE READER NOW UNDERSTANDS SUBSTANTIALLY DIFFERENT NEWS','Never invent a quote or a defect'])assert.ok(instruction.includes(phrase));
 assert.ok(!instruction.includes('PLAUSIBLE is not SUPPORTED'));assert.ok(!instruction.includes('Do not complete names'));
});
test('canonical contract stays byte identical',()=>assert.equal(createHash('sha256').update(readFileSync('config/editorial/iran-now-contract.txt')).digest('hex'),'9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456'));
