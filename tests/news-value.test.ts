import test from 'node:test';
import assert from 'node:assert/strict';
import {runCanonicalFlow,type CanonicalRequest} from '../src/lib/processing/canonical-flow';
import {newsValueIntakeSchema,newsValueInstructions} from '../src/lib/processing/news-value';
import {runCanonicalJob} from '../src/lib/processing/canonical-job';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Human-labeled fixtures test routing and the shipped classifier contract, not live model accuracy.
const cases:[string,string,'LOW_NEWS_VALUE'|'KEEP'|'BORDERLINE'][]=[
  [
    "political decision",
    "الحكومة الإيرانية تقر قانوناً جديداً لتنظيم الانتخابات.",
    "KEEP"
  ],
  [
    "diplomatic negotiations",
    "إيران تبدأ مفاوضات دبلوماسية مع دول الجوار.",
    "KEEP"
  ],
  [
    "nuclear diplomacy",
    "إيران تعلن جولة مفاوضات بشأن الاتفاق النووي.",
    "KEEP"
  ],
  [
    "military development",
    "الجيش الإيراني يكشف منظومة دفاع جوي جديدة.",
    "KEEP"
  ],
  [
    "IRGC security",
    "الحرس الثوري يعلن إحباط هجوم على منشأة عسكرية إيرانية.",
    "KEEP"
  ],
  [
    "economic sanctions",
    "عقوبات واسعة تستهدف صادرات النفط الإيرانية.",
    "KEEP"
  ],
  [
    "currency banking",
    "البنك المركزي الإيراني يقر سياسة جديدة لسعر الصرف.",
    "KEEP"
  ],
  [
    "tax policy",
    "محكمة إيرانية تلغي تعميماً رسمياً يعفي العقارات الفاخرة من الضرائب.",
    "KEEP"
  ],
  [
    "energy economics",
    "إيران توقع اتفاقاً كبيراً لتصدير الغاز إلى دول الجوار.",
    "KEEP"
  ],
  [
    "religion political core",
    "رجل دين إيراني بارز يعلن موقفاً سياسياً من قانون الانتخابات.",
    "KEEP"
  ],
  [
    "disaster economic core",
    "الفيضانات في إيران توقف إنتاج الطاقة الوطني وتدفع الحكومة إلى سياسة طوارئ اقتصادية.",
    "KEEP"
  ],
  [
    "routine sports",
    "فريق إيراني يفوز في مباراة بالدوري المحلي.",
    "LOW_NEWS_VALUE"
  ],
  [
    "major sports",
    "إيران تفوز لأول مرة ببطولة رياضية عالمية في إنجاز تاريخي.",
    "LOW_NEWS_VALUE"
  ],
  [
    "weather",
    "تتوقع الأرصاد في طهران أمطاراً خفيفة غداً.",
    "LOW_NEWS_VALUE"
  ],
  [
    "major flood casualties",
    "فيضانات كبرى في إيران تودي بحياة عشرات السكان وتشرد آلافاً.",
    "LOW_NEWS_VALUE"
  ],
  [
    "earthquake damage",
    "زلزال كبير في إيران يقتل مئات السكان ويدمر منازلهم.",
    "LOW_NEWS_VALUE"
  ],
  [
    "traffic",
    "ازدحام مروري صباحي على طرق طهران.",
    "LOW_NEWS_VALUE"
  ],
  [
    "fishing",
    "صيادو قرية إيرانية يعودون بحصيلة الصيد اليومية.",
    "LOW_NEWS_VALUE"
  ],
  [
    "mushroom deaths",
    "وفاة أربعة أفراد من عائلة إيرانية بعد تناول فطر سام.",
    "LOW_NEWS_VALUE"
  ],
  [
    "mine deaths",
    "ثلاثة عمال يموتون في حادث منجم في إيران.",
    "LOW_NEWS_VALUE"
  ],
  [
    "health",
    "مستشفى إيراني يعلن تعافي مريض من مرض نادر.",
    "LOW_NEWS_VALUE"
  ],
  [
    "routine crime",
    "الشرطة الإيرانية توقف سارق سيارة في حي سكني.",
    "LOW_NEWS_VALUE"
  ],
  [
    "municipal services",
    "بلدية طهران تصلح إنارة أحد الشوارع.",
    "LOW_NEWS_VALUE"
  ],
  [
    "ordinary religion",
    "مراسم دينية كبيرة في إيران بمشاركة آلاف المصلين.",
    "LOW_NEWS_VALUE"
  ],
  [
    "education",
    "جامعة إيرانية تعلن موعد بدء الدراسة.",
    "LOW_NEWS_VALUE"
  ],
  [
    "culture",
    "افتتاح مهرجان سينمائي كبير في إيران.",
    "LOW_NEWS_VALUE"
  ],
  [
    "sports political core",
    "مقاطعة بطولة بمشاركة إيران تثير خلافاً دبلوماسياً بين الحكومتين.",
    "KEEP"
  ],
  [
    "fishing security core",
    "البحرية الإيرانية تحبط هجوماً مسلحاً على سفن صيد في المياه الحدودية.",
    "KEEP"
  ],
  [
    "mine policy core",
    "بعد حادث منجم تعلن الحكومة الإيرانية تعليق قطاع صناعي رئيسي وإقرار سياسة اقتصادية جديدة للسلامة.",
    "KEEP"
  ],
  [
    "dramatic without core",
    "حريق ضخم في قرية إيرانية يدمر عشرات المنازل دون تطورات أخرى.",
    "LOW_NEWS_VALUE"
  ],
  [
    "borderline not a pass",
    "نقاش حول مشروع محلي في إيران ولم يتضح أثره بعد.",
    "BORDERLINE"
  ]
];
for(const [name,source,newsValue] of cases)test('news-value fixture: '+name,async()=>{
 const seen:CanonicalRequest[]=[];const result=await runCanonicalFlow(source,async r=>{seen.push(r);
 if(r.stage==='canonical_intake'){assert.deepEqual(r.input,{source});assert(r.instructions.includes(newsValueInstructions));assert(!r.instructions.includes('assess newsworthiness,'));return {iranRelated:true,rationale:'حدث إيراني',newsValue,newsValueRationale:source};}
 if(r.stage==='canonical_generate')return {title:'إيران الآن | خبر إيراني',body:source};
 assert.equal(r.stage,'canonical_check');return {sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:'PASS',defects:[]}]))};
 });
 assert.equal(result.status,newsValue!=='KEEP'?'FILTERED':'APPROVED');
 assert.equal(result.intake?.iranRelated,true);assert.equal(result.filterReason,newsValue!=='KEEP'?'LOW_NEWS_VALUE':undefined);
 assert.deepEqual(seen.map(r=>r.stage),newsValue!=='KEEP'?['canonical_intake']:['canonical_intake','canonical_generate','canonical_check']);
});
test('relevance takes precedence; invalid/missing value decision cannot silently accept',async()=>{
 const result=await runCanonicalFlow('مسؤول إسرائيلي يزور الأقصى دون أي صلة مادية بإيران',async()=>({iranRelated:false,rationale:'لا صلة',newsValue:'LOW_NEWS_VALUE',newsValueRationale:'محلي'}));
 assert.equal(result.filterReason,'UNRELATED_TO_IRAN');
 assert.equal(newsValueIntakeSchema.safeParse({iranRelated:true,rationale:'إيران'}).success,false);
 let calls=0;await assert.rejects(runCanonicalFlow('إيران',async()=>{calls++;return {iranRelated:true,rationale:'إيران',newsValue:'MAYBE',newsValueRationale:'غير واضح'};}));assert.equal(calls,1);
});
test('strict core contract excludes significance-only acceptance and preserves unchanged 40/40',()=>{
 for(const text of ['DEFAULT = LOW_NEWS_VALUE','POLITICS','MILITARY/SECURITY','ECONOMY','MAJOR SIGNIFICANCE ALONE DOES NOT OVERRIDE SCOPE','BORDERLINE is retained only','never set iranRelated=false merely','tax exemption','poisonous mushrooms','ordinary mine accident','UNRELATED_TO_IRAN'])assert(newsValueInstructions.includes(text));
 assert(!newsValueInstructions.includes('SIGNIFICANCE OVERRIDES TOPIC'));
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
