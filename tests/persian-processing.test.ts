import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {validateRendering,renderingInput,type RenderingReference} from '../src/lib/processing/evidence-rendering';
import {classificationReferences} from '../src/lib/processing/id-classification';
import {finalizeConstrainedDraft} from '../src/lib/processing/local-finalization';
import {processJob,claimJob} from '../src/lib/processing/engine';
import {ruleSet} from '../src/lib/processing/rules';
import {unknownProfile} from '../src/lib/processing/contracts';

const checked={scope:true,entitiesAndRelationships:true,namesAndTitles:true,numbers:true,attribution:true,negationAndModality:true,literalQuotes:true};
const ev=(source:string,excerpt:string,context=source)=>({excerpt,context});
type Case={source:string;extract:unknown;arabic:Record<string,string>;serious:boolean};
const cases:Record<string,Case>={
 claim:{source:'سخنگوی ارتش: جنگ با ایران ثابت کرد آمریکا نمی‌تواند در جایگاه یک ابرقدرت مشروع باشد\n\nآمریکا با چالش‌های جدی مواجه شده است.',extract:null,arabic:{'actor:1':'المتحدث باسم الجيش',action:'أثبتت',f1:'أثبتت الحرب مع إيران أن أميركا لا تستطيع أن تكون في موقع قوة عظمى مشروعة','f1:speaker':'المتحدث باسم الجيش'},serious:true},
 decision:{source:'مجمع تشخیص مصلحت با بخشی از مصوبه «مهریه» مخالفت کرد\n\nهیئت عالی نظارت مجمع، ماده ۱ و تبصره‌های ۳ و ۴ را مغایر سیاست‌های کلی دانست.',extract:null,arabic:{'actor:1':'مجمع تشخيص مصلحة النظام',action:'عارض',object:'جزءا من قرار المهر',f1:'عارض مجمع تشخيص مصلحة النظام جزءا من قرار المهر'},serious:false},
 bullets:{source:'رییس سازمان پیشگیری و مدیریت بحران شهر تهران در گفت‌وگو با ایسنا:\n🔹امسال احتمال وقوع بارش های سیلابی در تهران زیاد است.\n\n🔹۵۰۰ نفر از ۳۳ دستگاه گرد هم آمدند و ۱۰ کلاس آموزشی برگزار می‌شود.',extract:null,arabic:{'actor:1':'رئيس منظمة الوقاية وإدارة الأزمات في مدينة طهران',action:'قال',location:'طهران',f1:'هذا العام يرتفع احتمال هطول أمطار غزيرة في طهران','f1:speaker':'رئيس منظمة الوقاية وإدارة الأزمات في مدينة طهران',f2:'اجتمع 500 شخص من 33 جهة وتقام 10 دورات تدريبية','f2:speaker':'رئيس منظمة الوقاية وإدارة الأزمات في مدينة طهران'},serious:false},
};
cases.claim.extract={relevance:'POLITICAL_NEWS',actors:[ev(cases.claim.source,'سخنگوی ارتش')],action:ev(cases.claim.source,'ثابت کرد'),object:null,location:null,event_time:null,statements:[{evidence:ev(cases.claim.source,'جنگ با ایران ثابت کرد آمریکا نمی‌تواند در جایگاه یک ابرقدرت مشروع باشد'),speaker:ev(cases.claim.source,'سخنگوی ارتش')}]};
cases.decision.extract={relevance:'POLITICAL_NEWS',actors:[ev(cases.decision.source,'مجمع تشخیص مصلحت')],action:ev(cases.decision.source,'مخالفت کرد'),object:ev(cases.decision.source,'بخشی از مصوبه «مهریه»'),location:null,event_time:null,statements:[{evidence:ev(cases.decision.source,'مجمع تشخیص مصلحت با بخشی از مصوبه «مهریه» مخالفت کرد'),speaker:null}]};
const bulletHeading='رییس سازمان پیشگیری و مدیریت بحران شهر تهران در گفت‌وگو با ایسنا:';
const rainLine='🔹امسال احتمال وقوع بارش های سیلابی در تهران زیاد است.';
const classLine='🔹۵۰۰ نفر از ۳۳ دستگاه گرد هم آمدند و ۱۰ کلاس آموزشی برگزار می‌شود.';
cases.bullets.extract={relevance:'POLITICAL_NEWS',actors:[ev(cases.bullets.source,'رییس سازمان پیشگیری و مدیریت بحران شهر تهران',bulletHeading)],action:ev(cases.bullets.source,'در گفت‌وگو با ایسنا',bulletHeading),object:null,location:ev(cases.bullets.source,'تهران',bulletHeading),event_time:null,statements:[{evidence:ev(cases.bullets.source,'امسال احتمال وقوع بارش های سیلابی در تهران زیاد است.',rainLine),speaker:ev(cases.bullets.source,'رییس سازمان پیشگیری و مدیریت بحران شهر تهران',bulletHeading)},{evidence:ev(cases.bullets.source,'۵۰۰ نفر از ۳۳ دستگاه گرد هم آمدند و ۱۰ کلاس آموزشی برگزار می‌شود.',classLine),speaker:ev(cases.bullets.source,'رییس سازمان پیشگیری و مدیریت بحران شهر تهران',bulletHeading)}]};

function providerFor(sample:Case){
 let calls=0;
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{
  calls++;const req=JSON.parse(String(init?.body)),input=JSON.parse(req.contents[0].parts[0].text);
  let output:unknown;
  if(input.content)output=sample.extract;
  else if(input.references&&!input.rendered)output={entries:input.references.map((r:{id:string})=>({id:r.id,arabic:sample.arabic[r.id]}))};
  else if(input.references&&input.rendered)output={review:input.references.map((r:{id:string})=>({id:r.id,verdict:'SUPPORTED',checks:checked,issues:[]}))};
  else if(input.classificationReferences){const refs=input.classificationReferences;output={anchorIds:refs.requiredAnchorIds,factLabels:refs.requiredFactIds.map((id:string)=>({id,kind:id==='f1'&&sample.serious?'STATEMENT':id.startsWith('f')&&sample.arabic[`${id}:speaker`]?'STATEMENT':'FACT',material:false})),filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:sample.serious,rankUnverified:true,rationaleIds:[refs.requiredFactIds[0]]};}
  else if(input.atoms)output={titleAtomId:input.atoms[0].id,bodyAtomIds:input.atoms.map((a:{id:string})=>a.id)};
  else throw Error('unexpected stage');
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,thoughtsTokenCount:0}});
 });
 return {provider,calls:()=>calls};
}

for(const [name,sample] of Object.entries(cases))test(`Persian ${name} reaches grounded Arabic atoms`,async()=>{
 const {provider,calls}=providerFor(sample),input={content:sample.source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet};
 const understanding=await provider.understand(input,new AbortController().signal);
 assert.equal(understanding.language,'fa');assert.ok(understanding.rendering);
 assert.deepEqual(understanding.event.facts.map(f=>f.arabic),Object.entries(sample.arabic).filter(([id])=>/^f\d+$/.test(id)).map(([,v])=>v));
 const draft=await provider.draft({content:sample.source,understanding,rules:ruleSet},new AbortController().signal);
 const result=finalizeConstrainedDraft(draft,sample.source,understanding,unknownProfile);
 assert.ok(!result.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'),JSON.stringify(result.review));
 if(name==='bullets')assert.ok(!result.review.some(r=>r.code==='FORMAT_REVIEW'));
 assert.deepEqual(result.sentenceEvidence.flatMap(s=>s.factIds).every(id=>understanding.event.facts.some(f=>f.id===id)),true);
 assert.equal(calls(),5);
});

test('speaker heading scope survives bullet layout while a different intervening voice is rejected',()=>{
 assert.doesNotThrow(()=>validateMinimalExtraction(cases.bullets.extract,cases.bullets.source));
 const labelled='سخنگوی وزارت امور خارجه:\n🔹این تصمیم اعلام شد.';
 const labelledExtraction={relevance:'POLITICAL_NEWS',actors:[ev(labelled,'سخنگوی وزارت امور خارجه')],action:ev(labelled,'اعلام شد'),object:null,location:null,event_time:null,statements:[{evidence:ev(labelled,'این تصمیم اعلام شد.'),speaker:ev(labelled,'سخنگوی وزارت امور خارجه')}]};
 assert.doesNotThrow(()=>validateMinimalExtraction(labelledExtraction,labelled));
 const source='رییس سازمان در گفت‌وگو با ایسنا:\n🔹خبرنگار دیگری گفت:\n🔹این ادعا مطرح شد.';
 const bad={relevance:'POLITICAL_NEWS',actors:[ev(source,'رییس سازمان')],action:ev(source,'گفت‌وگو'),object:null,location:null,event_time:null,statements:[{evidence:ev(source,'این ادعا مطرح شد.'),speaker:ev(source,'رییس سازمان')}]};
 assert.throws(()=>validateMinimalExtraction(bad,source),/SPEAKER_ATTRIBUTION_MISMATCH/);
});

test('unsupported rendering, invented geography, changed numbers and fabricated quotes still fail',()=>{
 const sample=cases.bullets,x=validateMinimalExtraction(sample.extract,sample.source),refs=classificationReferences(x).entries.filter(e=>e.role!=='event_time') as RenderingReference[];
 const rendered={entries:renderingInput(refs).references.map(r=>({id:r.id,arabic:sample.arabic[r.id]}))};
 const review={review:refs.map(r=>({id:r.id,verdict:'SUPPORTED',checks:checked,issues:[]}))};
 assert.doesNotThrow(()=>validateRendering(sample.source,refs,rendered,review));
 assert.throws(()=>validateRendering(sample.source,refs,rendered,{review:review.review.map((r,i)=>i? r:{...r,verdict:'UNCERTAIN',checks:{...checked,scope:false},issues:['scope']})}),/UNVALIDATED_ARABIC_RENDERING/);
 const mutate=(id:string,arabic:string)=>({entries:rendered.entries.map(e=>e.id===id?{...e,arabic}:e)});
 assert.throws(()=>validateRendering(sample.source,refs,mutate('f2','اجتمع 501 شخص من 33 جهة وتقام 10 دورات تدريبية'),review),/NUMBER_MISMATCH/);
 assert.throws(()=>validateRendering(sample.source,refs,mutate('f1','قالت الحكومة الأميركية إن الأمطار كثيرة'),review),/ENTITY_UNSUPPORTED/);
 assert.throws(()=>validateRendering(sample.source,refs,mutate('f1','قال: «هذا العام يرتفع احتمال الأمطار»'),review),/QUOTE_ADDED/);
});

test('detected Persian language is persisted even when provider processing fails',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});const handle=`fa${Date.now()}`;
 const source=await db.source.create({data:{platform:'TELEGRAM',handle,name:'Persian persistence test',url:`https://t.me/${handle}`}});
 const post=await db.sourcePost.create({data:{sourceId:source.id,sourcePostId:'1',sourceUrl:`${source.url}/1`,originalContent:cases.decision.source,sourcePublishedAt:new Date()}});
 await db.processingJob.create({data:{sourcePostId:post.id,stage:'PROCESS_V1'}});
 try{
  const job=await claimJob(db,'persian-test',new Date(),true);assert.ok(job);
  await processJob(db,job,{id:'offline-failure',live:false,understand:async()=>{throw Error('offline failure');},compare:async()=>null,draft:async()=>null},new AbortController().signal);
  assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:post.id}})).originalLanguage,'fa');
 }finally{await db.processingJob.deleteMany({where:{sourcePost:{sourceId:source.id}}});await db.sourcePost.deleteMany({where:{sourceId:source.id}});await db.source.delete({where:{id:source.id}});await db.$disconnect();}
});
