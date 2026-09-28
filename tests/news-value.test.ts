import test from 'node:test';
import assert from 'node:assert/strict';
import {runCanonicalFlow,type CanonicalRequest} from '../src/lib/processing/canonical-flow';
import {newsValueIntakeSchema,newsValueInstructions} from '../src/lib/processing/news-value';
import {runCanonicalJob} from '../src/lib/processing/canonical-job';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Human-labeled fixtures test routing and the shipped classifier contract, not live model accuracy.
const cases:[string,string,'LOW_NEWS_VALUE'|'KEEP'|'BORDERLINE'][]=[
 ['routine weather','تتوقع الأرصاد في طهران أجواء غائمة وأمطاراً خفيفة غداً.','LOW_NEWS_VALUE'],
 ['routine traffic','ازدحام مروري اعتيادي على طريق طهران صباح اليوم.','LOW_NEWS_VALUE'],
 ['football result','فاز فريق بيرسبوليس الإيراني بهدف على منافسه في الدوري.','LOW_NEWS_VALUE'],
 ['athlete update','استأنف لاعب الفريق الإيراني تدريباته المعتادة اليوم.','LOW_NEWS_VALUE'],
 ['routine fishing','عاد صيادو قرية إيرانية بحصيلة الصيد اليومية المعتادة.','LOW_NEWS_VALUE'],
 ['municipal notice','بلدية طهران تعلن صيانة إنارة أحد الأزقة صباح غد.','LOW_NEWS_VALUE'],
 ['earthquake casualties','زلزال كبير في إيران يوقع عشرات القتلى ويشرد آلاف السكان.','KEEP'],
 ['flood emergency','فيضانات واسعة في إيران تقطع الطرق وتدفع السلطات لإجلاء آلاف السكان.','KEEP'],
 ['government decision','الحكومة الإيرانية تقر إصلاحاً وطنياً لنظام الدعم.','KEEP'],
 ['military security','الجيش الإيراني يعلن إحباط هجوم على منشأة دفاعية.','KEEP'],
 ['nuclear negotiation','إيران تعلن جولة مفاوضات جديدة بشأن برنامجها النووي.','KEEP'],
 ['sanctions','فرض عقوبات دولية واسعة على صادرات النفط الإيرانية.','KEEP'],
 ['currency policy','البنك المركزي الإيراني يعلن تغييراً شاملاً في سياسة سعر الصرف.','KEEP'],
 ['religious institution','هيئة دينية عليا في إيران تعلن إصلاحاً وطنياً لإدارة المؤسسات الدينية.','KEEP'],
 ['protests','احتجاجات واسعة في مدن إيرانية على قرار حكومي.','KEEP'],
 ['political sports exception','تعليق مشاركة إيران الرياضية ضمن عقوبات دولية يسبب أزمة دبلوماسية.','KEEP'],
 ['maritime exception','احتجاز سفن صيادين إيرانيين يثير أزمة أمنية ودبلوماسية بين البلدين.','KEEP'],
 ['borderline infrastructure','مشروع نقل إيراني محلي قد يربط مناطق صناعية بسوق التصدير؛ نطاق الأثر لم يتضح بعد.','BORDERLINE'],
 ['borderline social','نقاش في مؤسسة إيرانية بشأن إصلاح خدمات قد يمتد إلى محافظات أخرى.','BORDERLINE'],
];
for(const [name,source,newsValue] of cases)test('news-value fixture: '+name,async()=>{
 const seen:CanonicalRequest[]=[];const result=await runCanonicalFlow(source,async r=>{seen.push(r);
 if(r.stage==='canonical_intake'){assert.deepEqual(r.input,{source});assert(r.instructions.includes(newsValueInstructions));assert(!r.instructions.includes('assess newsworthiness,'));return {iranRelated:true,rationale:'حدث إيراني',newsValue,newsValueRationale:source};}
 if(r.stage==='canonical_generate')return {title:'إيران الآن | خبر إيراني',body:source};
 assert.equal(r.stage,'canonical_check');return {sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:'PASS',defects:[]}]))};
 });
 assert.equal(result.status,newsValue==='LOW_NEWS_VALUE'?'FILTERED':'APPROVED');
 assert.equal(result.intake?.iranRelated,true);assert.equal(result.filterReason,newsValue==='LOW_NEWS_VALUE'?'LOW_NEWS_VALUE':undefined);
 assert.deepEqual(seen.map(r=>r.stage),newsValue==='LOW_NEWS_VALUE'?['canonical_intake']:['canonical_intake','canonical_generate','canonical_check']);
});
test('relevance takes precedence; invalid/missing value decision cannot silently accept',async()=>{
 const result=await runCanonicalFlow('خبر في البرازيل',async()=>({iranRelated:false,rationale:'لا صلة',newsValue:'LOW_NEWS_VALUE',newsValueRationale:'محلي'}));
 assert.equal(result.filterReason,'UNRELATED_TO_IRAN');
 assert.equal(newsValueIntakeSchema.safeParse({iranRelated:true,rationale:'إيران'}).success,false);
 let calls=0;await assert.rejects(runCanonicalFlow('إيران',async()=>{calls++;return {iranRelated:true,rationale:'إيران',newsValue:'MAYBE',newsValueRationale:'غير واضح'};}));assert.equal(calls,1);
});
test('classifier policy preserves significance overrides, conservative borderline bias, and unchanged 40/40',()=>{
 for(const text of ['SIGNIFICANCE OVERRIDES TOPIC','never banned keywords','BORDERLINE (continues)','never set iranRelated=false merely','political/diplomatic','casualties','maritime','religious'])assert(newsValueInstructions.includes(text));
 assert.equal(createHash('sha256').update(readFileSync('config/editorial/iran-now-contract.txt')).digest('hex'),'9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456');
});
for(const mode of ['NORMAL','DIRECT'] as const)test(mode+': staging job persists LOW_NEWS_VALUE, Iran relevance, reason and audit without matching or generation',async()=>{
 const writes:Record<string,unknown>[]=[];const audits:Record<string,unknown>[]=[];const stages:string[]=[];
 const tx={$queryRaw:async()=>[],processingJob:{findUniqueOrThrow:async()=>({status:'RUNNING',lockedBy:'fixture',lockedAt:new Date()}),update:async()=>({})},source:{findUniqueOrThrow:async()=>({enabled:true,deletedAt:null,processingMode:mode})},editorialRuleSet:{upsert:async()=>({id:'rules'})},sourcePost:{update:async({data}:{data:Record<string,unknown>})=>{writes.push(data);return {};}},auditLog:{create:async({data}:{data:Record<string,unknown>})=>{audits.push(data);return {};}}};
 const db={$transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)};
 const job={id:'fixture',lockedBy:'fixture',sourcePost:{id:'fixture-post',sourceId:'fixture-source',originalContent:'أمطار خفيفة متوقعة في طهران',normalizedContent:'أمطار خفيفة متوقعة في طهران',sourcePublishedAt:new Date()}};
 const provider={canonicalRequest:async(r:CanonicalRequest)=>{stages.push(r.stage);assert.equal(r.stage,'canonical_intake');return {iranRelated:true,rationale:'طهران',newsValue:'LOW_NEWS_VALUE',newsValueRationale:'نشرة طقس اعتيادية'};}};
 const old=process.env.IRAN_TODAY_ENVIRONMENT;process.env.IRAN_TODAY_ENVIRONMENT='staging';
 try{await runCanonicalJob(db as unknown as Parameters<typeof runCanonicalJob>[0],job as unknown as Parameters<typeof runCanonicalJob>[1],provider as unknown as Parameters<typeof runCanonicalJob>[2],new AbortController().signal,mode);}finally{if(old===undefined)delete process.env.IRAN_TODAY_ENVIRONMENT;else process.env.IRAN_TODAY_ENVIRONMENT=old;}
 assert.deepEqual(stages,['canonical_intake']);assert.equal(writes.length,1);assert.equal(writes[0].status,'FILTERED');assert.equal(writes[0].rejectionReason,'LOW_NEWS_VALUE');assert.equal(writes[0].relevance,'POLITICAL_NEWS');
 const audit=audits[0].metadata as {filterReason:string;intake:{newsValueRationale:string}};assert.equal(audit.filterReason,'LOW_NEWS_VALUE');assert.equal(audit.intake.newsValueRationale,'نشرة طقس اعتيادية');
});
