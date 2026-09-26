import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCanonicalFlow,assertCanonicalApproval,canonicalCheckSchema,validateCanonicalCheck,type CanonicalRequest} from '../src/lib/processing/canonical-flow';
import {editorialContract,EDITORIAL_CONTRACT_SHA256} from '../src/lib/processing/editorial-contract';
import {ProcessingError} from '../src/lib/processing/contracts';

const article={title:'إيران الآن | افتتاح مكتبة في طهران',body:'أعلنت بلدية طهران افتتاح مكتبة عامة.'};
const source='أعلنت بلدية طهران افتتاح مكتبة عامة.';
const check=(failed:number[]=[])=>({sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:failed.includes(i+1)?'FAIL':'PASS',defects:failed.includes(i+1)?[{defect:'تغيير غير مدعوم في الخبر',correction:'استعادة المعنى المثبت في النص'}]:[]}]))});
function transport(outputs:unknown[],seen:CanonicalRequest[]){return async(r:CanonicalRequest)=>{seen.push(r);const next=outputs.shift();if(next instanceof Error)throw next;return next;};}

test('usable Iran news generates immediately after intake; all 40 checks approve without legacy receipts',async()=>{
 const seen:CanonicalRequest[]=[];const result=await runCanonicalFlow(source,transport([{iranRelated:true,rationale:'حدث في طهران'},article,check()],seen));
 assert.equal(result.status,'APPROVED');assert.deepEqual(seen.map(r=>r.stage),['canonical_intake','canonical_generate','canonical_check']);
 for(const r of seen.slice(1))assert.ok(r.instructions.includes(editorialContract));
 assertCanonicalApproval(result,source,article);assertCanonicalApproval(JSON.parse(JSON.stringify(result)),source,{body:article.body,title:article.title});assert.equal(result.contractHash,EDITORIAL_CONTRACT_SHA256);
});
test('unrelated intake filters without generation',async()=>{
 const seen:CanonicalRequest[]=[];const result=await runCanonicalFlow('خبر محلي في البرازيل',transport([{iranRelated:false,rationale:'لا صلة بإيران'}],seen));assert.equal(result.status,'FILTERED');assert.equal(seen.length,1);
});
test('empty and media-only placeholders without usable text cannot generate',async()=>{
 for(const text of ['', '   ', '📷'])await assert.rejects(runCanonicalFlow(text,async()=>{assert.fail('provider called');}),/SOURCE_TEXT_REQUIRED/);
});
for(const repairs of [1,2])test(`R${repairs} receives exact diagnosed sections and complete contract; full recheck approves`,async()=>{
 const seen:CanonicalRequest[]=[];const outputs:unknown[]=[{iranRelated:true,rationale:'إيران'},article];
 for(let i=0;i<repairs;i++)outputs.push(check([10,34]),article);outputs.push(check());
 const result=await runCanonicalFlow(source,transport(outputs,seen));assert.equal(result.status,'APPROVED');assert.equal(result.cycles.length,repairs+1);
 for(const r of seen.filter(r=>r.stage==='canonical_correct')){assert.ok(r.instructions.includes(editorialContract));assert.deepEqual((r.input as {failures:{section:number}[]}).failures.map(f=>f.section),[10,34]);}
 assert.equal(seen.filter(r=>r.stage==='canonical_check').length,repairs+1);assertCanonicalApproval(result,source,article);
});
test('R2 failure stops with concrete diagnostics; no R3',async()=>{
 const seen:CanonicalRequest[]=[];const result=await runCanonicalFlow(source,transport([{iranRelated:true,rationale:'إيران'},article,check([34]),article,check([34]),article,check([34])],seen));
 assert.equal(result.status,'NEEDS_REVIEW');assert.equal(seen.filter(r=>r.stage==='canonical_correct').length,2);assert.equal(result.cycles[2].check.sections['34'].status,'FAIL');
 assert.throws(()=>assertCanonicalApproval(result,source,article),/CANONICAL_APPROVAL_CHANGED/);
});
test('technical failure exits at same check without authorizing R1',async()=>{
 const seen:CanonicalRequest[]=[];await assert.rejects(runCanonicalFlow(source,transport([{iranRelated:true,rationale:'إيران'},article,new ProcessingError('GEMINI_HTTP_503',true)],seen)),/GEMINI_HTTP_503/);
 assert.equal(seen.filter(r=>r.stage==='canonical_correct').length,0);
});
test('missing section, contradictory status and N/A final quality are malformed checks',()=>{
 const incomplete=check();delete incomplete.sections['17'];assert.equal(canonicalCheckSchema.safeParse(incomplete).success,false);
 const contradictory=check();contradictory.sections['10'].status='FAIL';assert.throws(()=>validateCanonicalCheck(contradictory),/CANONICAL_CHECK_INVALID/);
 const final=check();final.sections['40'].status='NOT_APPLICABLE';assert.throws(()=>validateCanonicalCheck(final),/CANONICAL_CHECK_INVALID/);
});
test('changed source or article cannot reuse an approval',async()=>{
 const result=await runCanonicalFlow(source,transport([{iranRelated:true,rationale:'إيران'},article,check()],[]));
 assert.throws(()=>assertCanonicalApproval(result,source+' تغيير',article),/CANONICAL_APPROVAL_CHANGED/);
 assert.throws(()=>assertCanonicalApproval(result,source,{...article,body:'نص آخر'}),/CANONICAL_APPROVAL_CHANGED/);
});
// These controls test routing of diagnosed semantic failures, not model reliability.
for(const [defect,section] of [['invented agenda',34],['invented attribution',10],['number mutation',17],['date mutation',18],['location mutation',19],['planned to completed',34],['conditional to unconditional',34],['material omission',40]] as const)test(`${defect}: canonical FAIL routes to bounded correction rather than approval`,async()=>{
 const result=await runCanonicalFlow(source,transport([{iranRelated:true,rationale:'إيران'},article,check([section]),article,check([section]),article,check([section])],[]));assert.equal(result.status,'NEEDS_REVIEW');
});
import {readFileSync} from 'node:fs';
const natural=JSON.parse(readFileSync(new URL('./fixtures/post-generation-binding/frozen-21.json',import.meta.url),'utf8')) as {post:string;source:string;v0:{title:string;body:string}}[];
for(const [post,section,defect] of [
 ['irna_ar/19807',34,'لا يثبت النص أن جدول لقاء عُمان تضمن ملفات اللقاءات الأخرى'],
 ['irna_ar/19805',19,'ترويسة طهران ليست دليلاً على مكان المؤتمر'],
 ['khabarfouri/566114',15,'المصدر لا يثبت الاسم الكامل والمنصب المضافين'],
 ['iraninarabic/119467',1,'حظر الطيران لا يساوي حظر دعم السلاح التاريخي'],
 ['isna_arabic/12158',34,'لا توجد أزمات خدمية متفاقمة مثبتة في النص'],
 ['iraninarabic/119469',40,'النطاق يشمل مطارات أخرى وفئات متضررة أغفلت']
] as const)test(`saved natural ${post}: exact diagnosis reaches R1 with unchanged full source/contract`,async()=>{
 const f=natural.find(x=>x.post===post)!;assert.ok(f);const draft={title:f.v0.title,body:f.v0.body},seen:CanonicalRequest[]=[];
 const failed=check([section]);failed.sections[String(section)].defects[0].defect=defect;
 // The repeated failure proves no unchanged bad V0 is promoted; this fixture
 // does not pretend a mocked reviewer establishes live semantic reliability.
 const result=await runCanonicalFlow(f.source,transport([{iranRelated:true,rationale:'fixture'},draft,failed,draft,failed,draft,failed],seen));
 assert.equal(result.status,'NEEDS_REVIEW');
 for(const r of seen.filter(r=>r.stage==='canonical_correct')){const input=r.input as {source:string;failures:{defects:{defect:string}[]}[]};assert.equal(input.source,f.source);assert.equal(input.failures[0].defects[0].defect,defect);assert.ok(r.instructions.includes(editorialContract));}
});
