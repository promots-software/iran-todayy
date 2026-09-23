import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalSelection,normalStage,validateNormalExtractionCoverage} from '../src/lib/processing/normal-v2';
import {validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {validateSpeakerEvidence} from '../src/lib/processing/speaker-evidence';

import {TelegramReader,TelegramMonitor} from '../src/lib/telegram/monitor';
import {Api,type TelegramClient} from 'teleproto';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/normal-19709.json',import.meta.url),'utf8'));
const ev=(source:string,excerpt:string)=>({excerpt,start:source.indexOf(excerpt),end:source.indexOf(excerpt)+excerpt.length});
test('saved repair full assertion has explicit titled attribution',()=>{
 const s=fixture.responses[1].statements[0];validateSpeakerEvidence(fixture.source,ev(fixture.source,s.evidence.excerpt),ev(fixture.source,s.speaker.excerpt));
});
test('saved initial coverage failure includes candidate and exact offsets in its single repair',async()=>{
 let calls=0;const raw=normalSelection(fixture.responses[0],fixture.source).extraction;
 await assert.rejects(normalStage('extract',async repair=>{calls++;if(repair){assert.deepEqual(repair.previousOutput,raw);assert.match(repair.instructions,/untrusted candidate data/);assert.deepEqual(repair.issues,[{code:'UNCOVERED_SOURCE_SPAN',path:['sourceUnits','u1','start',0,'end',78]}]);}const x=validateMinimalExtraction(raw,fixture.source);return validateNormalExtractionCoverage(fixture.source,x,raw);}),/AI_SCHEMA_REPAIR_FAILED/);assert.equal(calls,2);
});
test('saved repair still fails material coverage: attribution fix cannot fabricate missing facts',()=>{
 const x=validateMinimalExtraction(normalSelection(fixture.responses[1],fixture.source).extraction,fixture.source);assert.throws(()=>validateNormalExtractionCoverage(fixture.source,x),/DIRECT_MATERIAL_COVERAGE_FAILED/);
});
for(const prefix of ['أكد مساعد وزير الخارجية للشؤون المالية والإدارية، ','قال نائب مدير المجلس، '])test('generic explicit title attribution '+prefix,()=>{const s=prefix+'أحمد سالم، خلال المراسم، أن المدرسة افتتحت.';validateSpeakerEvidence(s,ev(s,s),ev(s,'أحمد سالم'));});
for(const prefix of ['أكد الوزير عن ','أكد الوزير وخالد، ','اتهم الوزير ','أكد مساعد وزير الخارجية قال خالد، '])test('unsupported titled attribution fails '+prefix,()=>{const s=prefix+'أحمد سالم، أن المدرسة افتتحت.';assert.throws(()=>validateSpeakerEvidence(s,ev(s,s),ev(s,'أحمد سالم')),/SPEAKER_ATTRIBUTION_MISMATCH/);});
for(const kind of ['text','photo','video','document','album','empty'] as const)test('MTProto message field preserved: '+kind,async()=>{
 const content=kind==='empty'?'':'  نص المصدر الأصلي\nسطر ثانٍ  ';
 const media=kind==='photo'||kind==='album'||kind==='empty'?new Api.MessageMediaPhoto({}):kind==='text'?undefined:new Api.MessageMediaDocument({});
 const raw={id:12,message:content,date:1700000000,media,groupedId:kind==='album'?'123':undefined};
 const reader=new TelegramReader({getMessages:async()=>[raw]} as unknown as TelegramClient);
 const messages=await reader.messages('source_test',11);assert.equal(messages[0].text,content);
 const monitor=new TelegramMonitor({channel:async()=> '123',messages:async()=>messages});
 const result=await monitor.poll({handle:'source_test',cursor:{kind:'telegram-shadow-v1',channelId:'123',lastId:11}},new AbortController().signal);
 assert.equal(result.posts[0].content,content);assert.equal(result.posts[0].externalId,'12');assert.equal(result.posts[0].metadata.hasMedia,!!media);assert.equal(result.posts[0].metadata.messageKind,kind==='empty'?'MEDIA_ONLY':'TEXT');
 // This checks caption preservation only; the current connector does NOT aggregate albums.
});

