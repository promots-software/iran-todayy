import {validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceLanguage} from '../src/lib/processing/source-language';
import {validateSpeakerEvidence} from '../src/lib/processing/speaker-evidence';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
const ev=(text:string,excerpt:string)=>({excerpt,start:text.indexOf(excerpt),end:text.indexOf(excerpt)+excerpt.length});
test('production Arabic headlines and Persian acronym bullet reports detect locally',()=>{
 for(const text of ['رئيسة المفوضية الأوروبية: حرب إيران كلفت الاتحاد الأوروبي 90 مليار يورو إضافية من واردات الوقود الأحفوري','المكتب السياسي: تكرار الافتراءات يعكس عجز النظام عن إقناع الرأي العام بمبررات استمرار عدوانه وحصاره','أكدت البعثة في رسالة على X أن الطلبات الدولية لا تزال تلقى التجاهل.'])assert.equal(sourceLanguage(text),'ar');
 assert.equal(sourceLanguage('مترو و BRT تا دو ماه همچنان رایگان\nسخنگوی شهرداری تهران:\n🔹اکنون ۱۰۱ دستگاه اتوبوس دوکابین در تهران فعال هستند و ۳۱ دستگاه نیز دیروز وارد خاک کشور شد.'),'fa');
 for(const text of ['The minister قال إن الاجتماع في العاصمة.','قال الوزير إن الاجتماع في العاصمة. The meeting is over.','الكتاب دانشگاه','BRT تهران','the the the the'])assert.equal(sourceLanguage(text),'unknown');
});
test('exact speaker prefix inside a complete attributed assertion is grounded',()=>{
 const text='⭕️ المكتب السياسي: القرار معلن.';validateSpeakerEvidence(text,ev(text,'المكتب السياسي: القرار معلن.'),ev(text,'المكتب السياسي'));
 const t='قال المتحدث إن الاجتماع انتهى.';validateSpeakerEvidence(t,ev(t,t),ev(t,'المتحدث'));
 const unsafe='قال المتحدث إن الوزير أخطأ.';assert.throws(()=>validateSpeakerEvidence(unsafe,ev(unsafe,unsafe),ev(unsafe,'الوزير')),/SPEAKER_ATTRIBUTION_MISMATCH/);
});
test('explicit role headings govern contiguous Persian bullets including emoji variation selectors',()=>{
 const text='معاون اول رئیس‌جمهور:\n🔹️باید هزینه پروژه‌ها جبران شود.\n\n🔹️بخش خصوصی پیشنهادهای خود را ارائه کند.';
 validateSpeakerEvidence(text,ev(text,'باید هزینه پروژه‌ها جبران شود.'),ev(text,'معاون اول رئیس‌جمهور'));
 validateSpeakerEvidence(text,ev(text,'بخش خصوصی پیشنهادهای خود را ارائه کند.'),ev(text,'معاون اول رئیس‌جمهور'));
 for(const separator of ['روایت خبرنگار درباره موضوع دیگر.','وزیر گفت: این نظر من است.','🔹وزیر گفت: این نظر من است.','  روایت بدون نشانه.']){
 const other=text.replace('\n\n🔹️بخش','\n'+separator+'\n🔹️بخش');assert.throws(()=>validateSpeakerEvidence(other,ev(other,'بخش خصوصی پیشنهادهای خود را ارائه کند.'),ev(other,'معاون اول رئیس‌جمهور')),/SPEAKER_ATTRIBUTION_MISMATCH/);
 }
 const ambiguous=text.replace('معاون اول رئیس‌جمهور','موضوع جلسه');assert.throws(()=>validateSpeakerEvidence(ambiguous,ev(ambiguous,'باید هزینه پروژه‌ها جبران شود.'),ev(ambiguous,'موضوع جلسه')),/SPEAKER_ATTRIBUTION_MISMATCH/);
});
test('repeated evidence still requires unique verbatim context; no first-occurrence fallback',()=>{
 const text='قال المتحدث: الاجتماع انتهى.\nكرر المتحدث: الاجتماع انتهى.';
 assert.throws(()=>resolveContextEvidence({excerpt:'الاجتماع انتهى.',context:'الاجتماع انتهى.'},text),/AMBIGUOUS_EVIDENCE_CONTEXT/);
 const e={excerpt:'الاجتماع انتهى.',context:'كرر المتحدث: الاجتماع انتهى.',start:0,end:0};resolveContextEvidence(e,text);assert.equal(e.start,text.lastIndexOf(e.excerpt));
});

test('failed extraction preserves schema-checked output and exact failed field for diagnosis',()=>{
 const source='قال المتحدث: الاجتماع انتهى.\nكرر المتحدث: الاجتماع انتهى.';
 const raw={relevance:'POLITICAL_NEWS',actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:'الاجتماع انتهى.',context:'الاجتماع انتهى.'},speaker:null}]};
 assert.throws(()=>validateMinimalExtraction(raw,source),(e:unknown)=>{const error=e as {code:string;diagnostic:{field:string;output:unknown}};assert.equal(error.code,'AMBIGUOUS_EVIDENCE_CONTEXT');assert.equal(error.diagnostic.field,'statements.0.evidence');assert.deepEqual(error.diagnostic.output,raw);return true;});
});
