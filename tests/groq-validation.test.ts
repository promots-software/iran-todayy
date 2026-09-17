import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveContextEvidence,sourceLanguage,requireArabic,validateExtractionLanguageAndSpeakers} from '../src/lib/processing/groq-validation';
import {checkEvidence} from '../src/lib/processing/contracts';
test('repeated excerpt requires unique verbatim context; no first-occurrence fallback',()=>{
 const source='CBS reported. Later CBS said.';
 const e={excerpt:'CBS',context:'Later CBS said.',start:0,end:3};
 resolveContextEvidence(e,source);assert.equal(e.start,20);checkEvidence(source,e);
 assert.throws(()=>resolveContextEvidence({excerpt:'CBS',context:'CBS',start:0,end:3},source),/AMBIGUOUS/);
 assert.throws(()=>resolveContextEvidence({excerpt:'invented',context:source,start:0,end:3},source),/AMBIGUOUS/);
});
test('Persian is independently identified and rejected as Arabic prose',()=>{
 assert.equal(sourceLanguage('یکی از نظامیان به سی‌بی‌اس نیوز گفته که آسیب وارد شده'),'fa');
 assert.throws(()=>requireArabic('نظامیانی که در خدمت بودند'),/NON_ARABIC/);
 requireArabic('قال أحد العسكريين إن أضرارا لحقت بالقواعد.');
 assert.equal(sourceLanguage('short'),'unknown');
});
test('singular speaker must come from same claim paragraph and retain grounded translation',()=>{
 const source='یکی از نظامیان گفته که آسیب به پایگاه وارد شده';
 const e=(excerpt:string)=>({excerpt,start:source.indexOf(excerpt),end:source.indexOf(excerpt)+excerpt.length});
 const u={language:'fa',names:[],event:{actors:[],action:null,object:null,location:null,eventTime:null,summary:'قال أحد العسكريين إن أضرارا وقعت.',facts:[{id:'f',key:'damage',arabic:'وقعت أضرار',kind:'CLAIM' as const,material:true,verified:false,evidence:e('آسیب به پایگاه وارد شده'),speaker:{key:'UNNAMED_SERVICEMAN',arabic:'أحد العسكريين',evidence:e('یکی از نظامیان')}}]}};
 validateExtractionLanguageAndSpeakers(u,source);
 u.event.facts[0].speaker.arabic='العسكريون الإيرانيون';assert.throws(()=>validateExtractionLanguageAndSpeakers(u,source),/SPEAKER_TRANSLATION/);
 u.language='ar';assert.throws(()=>validateExtractionLanguageAndSpeakers(u,source),/SOURCE_LANGUAGE_MISMATCH/);
});
