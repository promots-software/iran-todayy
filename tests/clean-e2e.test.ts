import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
import {sourceMediaReviewRequired} from '../src/lib/publication-media';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {fixture} from './fixtures/processing';
import {ruleSet} from '../src/lib/processing/rules';
import {editorialScope} from '../src/lib/processing/editorial-scope';
test('context space-codepoint repair retains exact factual excerpt and original offsets',()=>{
 const source='عاجل|\u00a0\n\nمصادر محلية: افتتح المجلس مدرسة جديدة.\n\u00a0\n@source';
 const excerpt='افتتح المجلس مدرسة جديدة.',e={excerpt,context:source.replaceAll('\u00a0',' '),start:-1,end:-1};
 resolveContextEvidence(e,source);assert.equal(source.slice(e.start,e.end),excerpt);assert.equal(e.start,source.indexOf(excerpt));
});
test('space repair cannot pick repeated context or alter factual words/excerpt',()=>{
 for(const [source,excerpt,context]of [
 ['خبر\u00a0هنا\nخبر\u00a0هنا','خبر','خبر هنا'],
 ['خبر\u00a0هنا','خبر هنا','خبر هنا'],
 ['خبر\u00a0هنا','خبر','خبر هناك'],
 ['خبر خبر\u00a0هنا','خبر','خبر خبر هنا'],
 ])assert.throws(()=>resolveContextEvidence({excerpt,context},source),/AMBIGUOUS_EVIDENCE_CONTEXT/);
});
test('optional publication image is independent of source attachment; visual-dependent claims stay reviewable',()=>{
 assert.equal(sourceMediaReviewRequired({hasPhoto:true},'أعلنت الوزارة افتتاح مدرسة في طهران.'),false);
 for(const text of ['شاهد الفيديو لمعرفة النتيجة','در تصویر نتیجه آمده است','As shown in the video, the damage is visible'])assert.equal(sourceMediaReviewRequired({hasMedia:true},text),true);
});
test('Gemini atom ordering is local with all facts retained and no transport request',async()=>{
 let calls=0;const provider=new GeminiLanguageProvider('offline-test',async()=>{calls++;throw Error('NO_NETWORK');});
 const f=fixture('local','عباس عراقجي يزور طهران');
 const result=await provider.draft({content:f.content,understanding:f.understanding,rules:ruleSet},new AbortController().signal);
 assert.equal(calls,0);assert.ok(result.title.startsWith('إيران الآن |'));
 assert.deepEqual(new Set(result.sentences.flatMap(s=>s.factIds)),new Set(f.understanding.event.facts.map(f=>f.id)));
 await assert.rejects(provider.draft({content:f.content,understanding:{...f.understanding,priority:'P4'},rules:ruleSet},new AbortController().signal),/DRAFT_NOT_ACCEPTED/);
});
test('generic parliament and shared gulf reference do not establish institution nationality',()=>{
 assert.equal(editorialScope('پارلمان در مورد خلیج فارس تصمیم گرفت').status,'UNCERTAIN_SCOPE');
});
import {budgetRetryDelay,budgetDecision,limits} from '../src/worker/provider-guard';
test('budget deferral uses first safe rolling-window expiry without lifting hard caps',()=>{
 const now=100000000,rows=Array.from({length:60},(_,i)=>({at:now-3590000+i,usd:.001}));
 assert.equal(budgetRetryDelay(rows,1000,now),0);assert.equal(budgetDecision(rows,1000,now).allowed,true);
 assert.equal(budgetDecision(rows,1000,now+10000).allowed,true);
 assert.equal(budgetRetryDelay([{at:now-1000,usd:1}],1000,now),86399000);
 assert.equal(budgetRetryDelay([],limits.requestBytes+1,now),86400000);
});
test('named shared border waterway establishes coverage only, not ownership or institution identity',()=>{
 for(const text of ['مباحثات بشأن مضيق هرمز','طرح پیشرفت پایدار تنگه هرمز و خلیج فارس','Talks about the Strait of Hormuz'])assert.equal(editorialScope(text).status,'IN_SCOPE');
 assert.equal(editorialScope('اجتماع البرلمان بشأن الخليج').status,'UNCERTAIN_SCOPE');
 assert.equal(editorialScope('https://example.org/Strait of Hormuz @تنگه_هرمز').status,'UNCERTAIN_SCOPE');
});
