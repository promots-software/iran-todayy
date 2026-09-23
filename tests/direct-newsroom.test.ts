import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {directExtractionSchema,validateDirectExtraction,adaptDirectExtraction} from '../src/lib/processing/direct';
import {directBilingualSchema,prepareDirectBilingual,finalizeDirectBilingual} from '../src/lib/processing/direct-bilingual';
import {preparePublication,acceptPublication,publicationDraft,publicationUnits} from '../src/lib/processing/direct-publication';
import {validateSpeakerEvidence} from '../src/lib/processing/speaker-evidence';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {unknownProfile,validateUnderstanding} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {renderingChecks} from '../src/lib/processing/rendering-contract';
import {editorialDecision} from '../src/lib/processing/editorial-eligibility';
import {passingReview,geminiEnvelope} from './fixtures/direct-bilingual';
const fixtures=JSON.parse(readFileSync('tests/fixtures/direct-newsroom.json','utf8')) as {source:string;raw:z.input<typeof directExtractionSchema>}[];
const profile={...unknownProfile,verified:true,classification:'NEUTRAL' as const,authority:'AGENCY' as const};
const ev=(source:string,excerpt:string)=>({excerpt,context:source});
function fixture(i:number){
 const f=structuredClone(fixtures[i]);
 if(i===2){const s=f.source.slice(f.source.indexOf('وأضاف'));f.raw.statements.push({evidence:ev(f.source,s),speaker:ev(f.source,'المتحدث باسم وزارة الطاقة الإيرانية'),kind:'STATEMENT',material:true});}
 if(i===4){f.raw.statements[0].speaker=ev(f.source,'وزارة النقل في إيران');f.raw.statements[0].kind='STATEMENT';f.raw.safety.priority='P2';}
 return f;
}
function input(source:string){return {processingMode:'DIRECT' as const,content:source,publishedAt:new Date(),profile,rules:ruleSet};}
function proposalFor(f:ReturnType<typeof fixture>){return {title:{text:f.raw.statements[0].evidence.excerpt.replace(/\.$/u,''),factIds:['f1']},body:f.raw.statements.length>1?f.raw.statements.map((s,i)=>({text:s.evidence.excerpt,factIds:[`f${i+1}`]})):[]};}
function coverageFor(f:ReturnType<typeof fixture>){return publicationUnits(f.source).map(u=>({unitId:u.id,nonFactual:false,factIds:f.raw.statements.map((_,i)=>`f${i+1}`)}));}
function supported(proposal:ReturnType<typeof proposalFor>){return {review:['title',...proposal.body.map((_,i)=>`body:${i+1}`)].map(id=>({id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[]};}
function understanding(f:ReturnType<typeof fixture>){return adaptDirectExtraction(validateDirectExtraction(f.raw,f.source),f.source);}
for(const verb of ['أعلن','أعلنت','قال','قالت','وقال','وقالت','أوضح','أوضحت','وأضاف','وأضافت'])test('explicit Arabic speaker introduction '+verb,()=>{
 const s=`${verb} الوزارة إن المشروع يبدأ غداً.`,speaker='الوزارة';
 validateSpeakerEvidence(s,{excerpt:s,start:0,end:s.length},{excerpt:speaker,start:s.indexOf(speaker),end:s.indexOf(speaker)+speaker.length});
});
test('Persian speaker grounding checks exact source, not handcrafted speech syntax',()=>{
 const source='وزارت راه اعلام کرد پروژه آغاز شده است.';const speaker='وزارت راه';validateSpeakerEvidence(source,{excerpt:source,start:0,end:source.length},{excerpt:speaker,start:0,end:speaker.length});
 const bad='گزارش درباره وزارت راه منتشر شده است.';assert.throws(()=>validateSpeakerEvidence(bad,{excerpt:bad,start:0,end:bad.length},{excerpt:'شخص مخترع',start:bad.indexOf(speaker),end:bad.indexOf(speaker)+speaker.length}),/INVALID_EVIDENCE/);
});
test('FACT with explicit speaker rejected by structured contract',()=>{
 const f=fixture(1);const x={...f.raw,statements:f.raw.statements.map(s=>({...s,kind:'FACT'}))};assert.equal(directExtractionSchema.safeParse(x).success,false);
});
for(const i of [0,1,3])test('Arabic case '+(i+1)+' uses matching plus canonical article, two calls, READY',async()=>{
 const f=fixture(i),publication=proposalFor(f),coverage=coverageFor(f);let calls=0;
 const provider=new GeminiLanguageProvider('offline',async()=>{calls++;return Response.json(geminiEnvelope(calls===1?{...f.raw,coverage}:{title:publication.title.text,body:publication.body.map(p=>p.text).join('\n'),diagnostics:[]}));});
 const u=validateUnderstanding(await provider.understand(input(f.source),new AbortController().signal),f.source);
 const final=await provider.draft({processingMode:'DIRECT',content:f.source,understanding:u,rules:ruleSet},new AbortController().signal);
 assert.equal(calls,2);assert.equal(final.title.replace(/\.$/u,''),'إيران الآن | '+publication.title.text);assert.equal(editorialDecision({validated:true,review:'review' in final?final.review:[]},{autoPublish:false,shadowMode:true,requireApproval:true}).editorialEligibility,'READY_TO_PUBLISH');
});
test('message 12 omitted final assertion cannot pass; complete original coverage can',()=>{
 const missing=fixtures[2],u=understanding(missing),mp=proposalFor(missing);mp.title.text='إعلان عن مشروع جديد';const incomplete=preparePublication(missing.source,u,mp,coverageFor(missing)),review=supported(mp);review.fullSourceCovered=false;assert.throws(()=>acceptPublication(missing.source,u,incomplete,review),/DIRECT_PUBLICATION_UNSUPPORTED/);
 const complete=fixture(2),v=understanding(complete),proposal=proposalFor(complete);
 // Each standalone line keeps its explicit speaker rather than resolving identity.
 proposal.title.text='قال المتحدث باسم وزارة الطاقة الإيرانية إن '+complete.raw.statements[0].evidence.excerpt;
 proposal.body=complete.raw.statements.map((s,i)=>({text:i<2?'قال المتحدث باسم وزارة الطاقة الإيرانية إن '+s.evidence.excerpt:'قال المتحدث باسم وزارة الطاقة الإيرانية إن الوزارة ستعلن تفاصيل إضافية عن مراحل المشروع بعد انتهاء الاختبارات الفنية.',factIds:[`f${i+1}`]}));
 const prepared=preparePublication(complete.source,v,proposal,coverageFor(complete));assert.equal(prepared.local,false);assert.throws(()=>acceptPublication(complete.source,v,prepared));
 const receipt=acceptPublication(complete.source,v,prepared,supported(proposal));assert(publicationDraft(complete.source,{...v,publicationProposal:receipt}).body.includes('بعد انتهاء الاختبارات الفنية'));
});
test('retained independent review rejects unsupported meaning and validates exact proposal',()=>{
 const f=fixture(4),u=understanding(f),proposal=proposalFor(f);proposal.title.text='وزارة النقل تعلن مشروعاً جديداً';
 const prepared=preparePublication(f.source,u,proposal,coverageFor(f));assert.equal(prepared.local,false);
 assert.throws(()=>acceptPublication(f.source,u,prepared));
 const receipt=acceptPublication(f.source,u,prepared,supported(proposal));assert.equal(receipt.method,'INDEPENDENT');
});
test('retained Persian translation receipt still requires independent grounding review',()=>{
 const f=structuredClone(fixtures[5]);f.raw.statements[0].kind='OUTCOME';const raw=directBilingualSchema.parse(f.raw);
 const prepared=prepareDirectBilingual(raw,f.source);assert.throws(()=>finalizeDirectBilingual(f.source,prepared,{}));
 assert(finalizeDirectBilingual(f.source,prepared,passingReview(f.source,prepared)).fullSourceCoverage);
});
for(const [name,from,to] of [['number','12','13'],['date','5 أكتوبر','6 أكتوبر'],['location','طهران','بغداد'],['attribution','هيئة السكك الحديدية الإيرانية','وزارة النقل'],['quote','الاختبار الأولى','الاختبار «الأولى»']] as const)test('reject '+name+' mutation',()=>{
 const f=fixture(3),p=proposalFor(f);p.title.text=p.title.text.replace(from,to);const u=understanding(f);if(name==='location'||name==='attribution'){const prepared=preparePublication(f.source,u,p,coverageFor(f));assert.equal(prepared.local,false);const review=supported(p);review.review[0].verdict='UNSUPPORTED';assert.throws(()=>acceptPublication(f.source,u,prepared,review),/UNSUPPORTED/);}else assert.throws(()=>preparePublication(f.source,u,p,coverageFor(f)));
});
for(const addition of [' وربما لن يبدأ المشروع',' بسبب اتفاق جديد',' بمشاركة شركة مجهولة',' وهو مشروع بلده'])test('unproven semantic change never passes one-call '+addition,()=>{
 const f=fixture(0),p=proposalFor(f);p.title.text+=addition;const u=understanding(f),prepared=preparePublication(f.source,u,p,coverageFor(f));assert.equal(prepared.local,false);assert.throws(()=>acceptPublication(f.source,u,prepared));const rejected=supported(p);rejected.review[0].verdict='UNSUPPORTED';assert.throws(()=>acceptPublication(f.source,u,prepared,rejected),/DIRECT_PUBLICATION_UNSUPPORTED/);
});
test('partial source map, fabricated boilerplate and unknown IDs fail closed',()=>{
 const f=fixture(0),u=understanding(f),p=proposalFor(f);assert.throws(()=>preparePublication(f.source,u,p,[]));assert.throws(()=>preparePublication(f.source,u,p,[{unitId:'u1',factIds:[],nonFactual:true}]),/COVERAGE/);p.title.factIds=['f99'];assert.throws(()=>preparePublication(f.source,u,p,coverageFor(f)),/INVALID_DRAFT_FACT_LINK/);
});
test('receipt rejects changed text and changed factual provenance; local edit preserves modality',()=>{
 const f=fixture(0),u=understanding(f),p=preparePublication(f.source,u,proposalFor(f),coverageFor(f)),receipt=acceptPublication(f.source,u,p);const changed=structuredClone(receipt);changed.proposal.title.text+=' ولا شيء آخر';assert.throws(()=>publicationDraft(f.source,{...u,publicationProposal:changed}));assert.throws(()=>publicationDraft(f.source+' نص جديد',{...u,publicationProposal:receipt}));
});

test('retained safe literal MSA transformation cannot reverse modality',()=>{
 const source='أعلنت الوزارة أن أعمال المشروع رح تبدأ الأسبوع الجاي.';
 const raw={actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:ev(source,source),speaker:ev(source,'الوزارة'),kind:'STATEMENT',material:true}],safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}};
 const u=adaptDirectExtraction(validateDirectExtraction(raw,source),source);
 const publication={title:{text:'أعلنت الوزارة أن أعمال المشروع ستبدأ الأسبوع المقبل',factIds:['f1']},body:[]};
 const prepared=preparePublication(source,u,publication,[{unitId:'u1',factIds:['f1'],nonFactual:false}]);assert(prepared.local);
});
test('literal quote mutation and negation reversal cannot be locally accepted',()=>{
 const f=fixture(0),source=f.source+' وقالت الوزارة «لن تتوقف الخدمة غداً».',raw=JSON.parse(JSON.stringify(f.raw).split(f.source).join(source));
 const u=adaptDirectExtraction(validateDirectExtraction(raw,source),source),coverage=[{unitId:'u1',factIds:['f1'],nonFactual:false}];
 const proposal={title:{text:source,factIds:['f1']},body:[]};assert(preparePublication(source,u,proposal,coverage).local);
 proposal.title.text=source.replace('لن تتوقف','ستتوقف');assert.throws(()=>preparePublication(source,u,proposal,coverage),/QUOTE/);
 const g=fixture(0),p=proposalFor(g);p.title.text=p.title.text.replace('إطلاق','عدم إطلاق');const check=preparePublication(g.source,understanding(g),p,coverageFor(g));assert.equal(check.local,false);assert.throws(()=>acceptPublication(g.source,understanding(g),check));
});
test('truncated generation or independent-review response cannot produce a trusted publication',async()=>{
 for(const stage of [1,2]){
 const f=fixture(0),publication=proposalFor(f);publication.title.text=publication.title.text.replace('إطلاق','تدشين');let calls=0;
 const provider=new GeminiLanguageProvider('offline',async()=>{calls++;return Response.json(geminiEnvelope(calls===1?{...f.raw,coverage:coverageFor(f)}:{title:publication.title.text,body:'',diagnostics:[]},calls===stage?'MAX_TOKENS':'STOP'));});
 await assert.rejects((async()=>{const u=await provider.understand(input(f.source),new AbortController().signal);return provider.draft({processingMode:'DIRECT',content:f.source,understanding:u,rules:ruleSet},new AbortController().signal);})(),/GEMINI_INCOMPLETE/);assert.equal(calls,stage);
 }
});
