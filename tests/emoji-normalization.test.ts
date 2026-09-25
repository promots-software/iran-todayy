import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProcessingSource as normalize,processingSource} from '../src/lib/processing/processing-source';

const cases:[string,string,string][]=[
 ['01 Arabic unchanged','أقر المجلس القرار.\n  بشأن النقل؛ نعم؟','أقر المجلس القرار.\n  بشأن النقل؛ نعم؟'],
 ['02 Persian unchanged','رئیس‌جمهور ایران گفت: «این تصمیم است».','رئیس‌جمهور ایران گفت: «این تصمیم است».'],
 ['03 English unchanged',"Council's announcement:  ready.\n\tNext", "Council's announcement:  ready.\n\tNext"],
 ['04 mixed unchanged','إيران and Iran — خبر','إيران and Iran — خبر'],
 ['05 ordinary emoji','إيران 🔴 تعلن القرار','إيران تعلن القرار'],
 ['06 multiple emoji','🔴 إيران ✅ تعلن 📢 القرار','إيران تعلن القرار'],
 ['07 repeated emoji','🔴🔴 خبر عاجل','خبر عاجل'],
 ['08 variation selector','خبر ❤️ جديد','خبر جديد'],
 ['09 skin tone','خبر 👍🏽 جديد','خبر جديد'],
 ['10 ZWJ','خبر 👩🏽‍⚕️ جديد 👨‍👩‍👧‍👦','خبر جديد'],
 ['11 flags','الرئيس 🇮🇷 يلتقي الوفد 🇱','الرئيس يلتقي الوفد'],
 ['12 keycaps','خبر 1️⃣ 2⃣ #️⃣ *️⃣ جديد','خبر جديد'],
 ['13 Arabic word boundary','إيران🔴تعلن','إيران تعلن'],
 ['14 Latin word boundary','Iran🔴announces','Iran announces'],
 ['15 punctuation','خبر🔴، تصريح ✅؛ (جديد).','خبر ، تصريح ؛ (جديد).'],
 ['16 hashtag','#Iran 🔴 news','#Iran news'],
 ['17 Arabic hashtag','#الميادين 🔴 خبر','#الميادين خبر'],
 ['18 mention','@mayadeenchannel 🔴 خبر','@mayadeenchannel خبر'],
 ['19 URL','https://example.com/a?q=1&b=2#news 🔴 خبر','https://example.com/a?q=1&b=2#news خبر'],
 ['20 numbers','١٢٣ ۱۲۳ 123 3.50 ٥٪ 🔴','١٢٣ ۱۲۳ 123 3.50 ٥٪'],
 ['21 dates','2026-09-25 و٢٥/٩/٢٠٢٦ 🔴','2026-09-25 و٢٥/٩/٢٠٢٦'],
 ['22 quotes','«خبر» "Iran" \'quote\' 🔴','«خبر» "Iran" \'quote\''],
];
for(const [name,raw,expected] of cases)test(name,()=>assert.equal(normalize(raw),expected));
test('23 raw provenance and historical coordinates unchanged',()=>{
 const raw='🔴 إيران تعلن القرار',post={originalContent:raw,normalizedContent:normalize(raw)};
 assert.equal(post.originalContent,raw);assert.equal(processingSource(post),'إيران تعلن القرار');
 assert.equal(processingSource({originalContent:raw,normalizedContent:null}),raw);
 assert.equal(processingSource({originalContent:raw,normalizedContent:''}),'');
});
test('24 complete emoji sequences removed without remnants',()=>{
 const raw='🔴❤️👍🏽👩🏽‍⚕️🇮🇷1️⃣🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} نص';
 assert.equal(normalize(raw),'نص');
});
test('30 idempotence and whitespace localization',()=>{
 for(const [,raw] of cases)assert.equal(normalize(normalize(raw)),normalize(raw));
 assert.equal(normalize('  أول  سطر\n🔴  ثاني\n\tنص  آخر  '),'  أول  سطر\nثاني\n\tنص  آخر  ');
});
test('ordinary Unicode text symbols and URL bytes are preserved',()=>{
 const raw='© ™ ∑ € → ☎ ½ ① https://example.com/😀?x=1';assert.equal(normalize(raw),raw);
});

import {checkEvidence} from '../src/lib/processing/contracts';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
import {checkpointCall,type CheckpointStore} from '../src/worker/checkpoints';
test('25 evidence coordinates resolve against canonical source',()=>{const raw='🔴 خبر عن إيران',text=normalize(raw),e={excerpt:'إيران',context:text,start:0,end:0};resolveContextEvidence(e,text);assert.equal(e.start,text.indexOf('إيران'));assert.notEqual(e.start,raw.indexOf('إيران'));});
test('26 existing normalized content is authoritative; no raw fallback on invalid evidence',()=>{const raw='🔴 خبر عن إيران',text=normalize(raw),e={excerpt:'إيران',start:text.indexOf('إيران'),end:text.length};assert.doesNotThrow(()=>checkEvidence(processingSource({originalContent:raw,normalizedContent:text}),e));assert.throws(()=>checkEvidence(raw,e));const rawEvidence={...e,start:raw.indexOf('إيران'),end:raw.length};assert.throws(()=>checkEvidence(processingSource({originalContent:raw,normalizedContent:text}),rawEvidence));assert.doesNotThrow(()=>checkEvidence(processingSource({originalContent:raw}),rawEvidence));});
test('29 checkpoint reconstruction uses stored text without renormalizing history',async()=>{const post={originalContent:'🔴 خبر عن إيران',normalizedContent:'خبر عن إيران'};let calls=0;const store:CheckpointStore={load:async()=>({output:{content:processingSource(post)}}),start:async()=>assert.fail(),finish:async()=>assert.fail()};const output=await checkpointCall(store,processingSource(post),async()=>{calls++;return {content:''};});assert.equal(output.content,processingSource(JSON.parse(JSON.stringify(post))));assert.equal(calls,0);});
