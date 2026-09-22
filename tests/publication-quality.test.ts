import test from 'node:test';
import assert from 'node:assert/strict';
import {attributionLead,normalizeAttributionAgreement,hasExplicitArabicAttribution} from '../src/lib/processing/attribution-rendering';
import {finalizeBodyPunctuation} from '../src/lib/publication-finalization';
import {formatTelegram,readTelegramSnapshot} from '../src/lib/telegram/format';
import {editDraft} from '../src/lib/processing/editorial';
import {fixture,official} from './fixtures/processing';
import {validateDirectExtraction,adaptDirectExtraction} from '../src/lib/processing/direct';
import {buildAtoms,renderSelection} from '../src/lib/processing/constrained-rewrite';
import {finalizeSelection} from '../src/lib/processing/local-finalization';

for(const [kind,speaker,lead] of [
 ['person','أحمد حسن','قال أحمد حسن:'],['spokesperson','المتحدث باسم الوزارة','قال المتحدث باسم الوزارة:'],
 ['institution','وزارة الصحة','قالت وزارة الصحة:'],['sources','مصادر محلية','بحسب مصادر محلية:'],
 ['countries','دول أوروبية وآسيوية','بحسب دول أوروبية وآسيوية:'],['diplomatic','مصادر دبلوماسية','بحسب مصادر دبلوماسية:'],
 ['security','مصادر أمنية','بحسب مصادر أمنية:'],['medical','مصادر طبية','بحسب مصادر طبية:'],
 ['joint statement','بيان مشترك','بحسب بيان مشترك:'],
] as const)test('grounded attribution grammar: '+kind,()=>{
 assert.equal(attributionLead(speaker),lead);
 const text=normalizeAttributionAgreement(`قال ${speaker}: لم يتغير الموقف وقد يُبحث لاحقاً.`,speaker);
 assert.equal(text,lead+' لم يتغير الموقف وقد يُبحث لاحقاً.');
 assert(hasExplicitArabicAttribution(text,speaker));assert.equal(normalizeAttributionAgreement(text,speaker),text);
 for(const verb of ['أعلن','أكد','نفى','حذر','أعرب','ذكر']){const source=`${verb} ${speaker}: مضمون الخبر`;assert.equal(normalizeAttributionAgreement(source,speaker),source);}
});
test('generic plural heads, unrelated adjectives and compound entities have no masculine said frame',()=>{
 for(const speaker of ['مصادر اقتصادية','الدول المجاورة','وزارات متعددة','جهات مستقلة','حكومة المدينة ووزارة النقل','إيران وتركيا','البيان المشترك']){
  assert(!attributionLead(speaker).startsWith('قال '));
  assert(!normalizeAttributionAgreement('إيران الآن | قال '+speaker+': لا تغيير',speaker).includes('قال '+speaker));
 }
});
for(const speaker of ['مصادر محلية','دول أوروبية وآسيوية'])test('validated evidence to final publication keeps collective attribution: '+speaker,()=>{
 const claim='لم يتغير الموقف.',source=speaker+': '+claim,e=(excerpt:string)=>({excerpt,context:source});
 const extracted=validateDirectExtraction({actors:[e(speaker)],action:e('يتغير'),object:e('الموقف'),location:null,event_time:null,statements:[{evidence:e(claim),speaker:e(speaker),kind:'STATEMENT',material:false}],safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:true,rankUnverified:false}},source);
 const u=adaptDirectExtraction(extracted,source),atoms=buildAtoms(source,u),selection={titleAtomId:'f1',bodyAtomIds:['f1']};
 const draft=renderSelection(selection,atoms),final=finalizeSelection(selection,source,u,official);
 assert.equal(draft.title,'إيران الآن | بحسب '+speaker+': لم يتغير الموقف');
 assert.equal(final.title,draft.title);assert(!final.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'));assert.equal(final.body,'');
 assert(final.sentenceEvidence.some(s=>s.text===final.title&&s.factIds.includes('f1')));
 assert.equal(formatTelegram(final.title,final.body).text,'<b>'+final.title+'</b>');
});
for(const [body,expected] of [['نص الخبر','نص الخبر.'],['نص الخبر.','نص الخبر.'],['هل انتهى؟','هل انتهى؟'],['انتهى!','انتهى!'],['قال: «لن نغادر»','قال: «لن نغادر».'],['قال: «لن نغادر.»','قال: «لن نغادر.»'],['فقرة أولى.\n\nفقرة ثانية','فقرة أولى.\n\nفقرة ثانية.'],['','']] as const)test('body final punctuation '+JSON.stringify(body),()=>{assert.equal(finalizeBodyPunctuation(body),expected);assert.equal(finalizeBodyPunctuation(expected),expected);});
test('automatic editorial finalization updates exact sentence provenance with final punctuation',()=>{
 const f=fixture('punctuation','عباس عراقجي يزور طهران');const out=editDraft(f.draft,f.content,f.understanding,official);
 assert(out.body.endsWith('.'));assert(out.sentenceEvidence.some(s=>s.text===out.body));
 assert(!out.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'));assert(!out.title.endsWith('.'));
});
test('real headline and multi-paragraph Arabic body: exactly one bold line and escaped normal body',()=>{
 const title='إيران الآن | وزارة النقل تعلن افتتاح الطريق';
 const body=finalizeBodyPunctuation('أعلنت وزارة النقل افتتاح الطريق.\n\nوقالت: «الطريق متاح للجميع».\n\nالعلامات < و > و & نص عادي');
 const f=formatTelegram(title,body);
 assert.equal(f.text,`<b>${title}</b>\n\n${body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}`);
 assert.equal((f.text.match(/<b>/g)||[]).length,1);assert(!f.text.split('</b>\n\n')[1].includes('<b>'));
 assert.equal(f.body,body);assert.equal(f.plainText,title+'\n\n'+body);assert.equal((f.text.match(/إيران الآن/g)||[]).length,1);
 assert.equal(readTelegramSnapshot(f)?.text,f.text);
 assert.equal(formatTelegram('خبر عاجل','').text,'<b>إيران الآن | خبر عاجل</b>');
});
