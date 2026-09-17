import test from 'node:test';
import assert from 'node:assert/strict';
import {editDraft} from '../src/lib/processing/editorial';
import {rewriteInput,rewriteInstructions} from '../src/lib/processing/rewrite-contract';
import {fixture,official} from './fixtures/processing';
const sample=()=>fixture('rewrite','قال المسؤول إن الاجتماع انتهى.','ar','قال المسؤول إن الاجتماع انتهى.');
test('supported title and body retain valid fact provenance',()=>{
 const f=sample();const d=editDraft(f.draft,f.content,f.understanding,official);
 assert.deepEqual(d.sentenceEvidence,[
  {text:'قال المسؤول إن الاجتماع انتهى.',factIds:['rewrite:visit']},
  {text:'قال المسؤول إن الاجتماع انتهى',factIds:['rewrite:visit']},
 ]);
 assert.ok(d.sentenceEvidence.some(s=>s.text===d.title));
});
test('empty and unknown fact links are rejected',()=>{
 for(const ids of [[],['missing']]) {const f=sample();f.draft.sentences[0].factIds=ids;assert.throws(()=>editDraft(f.draft,f.content,f.understanding,official),/INVALID_DRAFT_SCHEMA|INVALID_DRAFT_FACT_LINK/);}
});
test('title and uncovered body text cannot escape provenance',()=>{
 const f=sample();f.draft.title='عنوان آخر';assert.throws(()=>editDraft(f.draft,f.content,f.understanding,official),/MISSING_TITLE_PROVENANCE/);
 const g=sample();g.draft.body+=' تفاصيل إضافية.';assert.throws(()=>editDraft(g.draft,g.content,g.understanding,official),/INCOMPLETE_DRAFT_PROVENANCE/);
});
test('source text without literal quote delimiters cannot become a protected QUOTE',()=>{
 const f=sample();f.draft.protectedSpans=[{kind:'QUOTE',text:f.content,evidence:f.understanding.event.facts[0].evidence}];
 assert.throws(()=>editDraft(f.draft,f.content,f.understanding,official),/INVALID_LITERAL_QUOTE/);
});
test('literal source quotation must appear verbatim in output',()=>{
 const f=fixture('quote','«انتهى الاجتماع»','ar','«انتهى الاجتماع»');
 f.draft.protectedSpans=[{kind:'QUOTE',text:f.content,evidence:f.understanding.event.facts[0].evidence}];
 assert.doesNotThrow(()=>editDraft(f.draft,f.content,f.understanding,official));
 f.draft.protectedSpans[0].text='انتهى اللقاء';
 assert.throws(()=>editDraft(f.draft,f.content,f.understanding,official),/INVALID_PROTECTED_SPAN/);
});
test('invented attribution rule decisions remain rejected',()=>{
 const f=sample();f.draft.decisions=[{ruleId:'ATTRIBUTION',from:'قال',to:'ذكر',context:'نسب الكلام',evidence:f.understanding.event.facts[0].evidence}];
 assert.throws(()=>editDraft(f.draft,f.content,f.understanding,official),/INVALID_RULE_DECISION/);
});
test('rewrite payload excludes unextracted details and anchors',()=>{
 const f=sample();const extra=' تفاصيل غير مستخرجة عن مكان آخر.';
 const payload=rewriteInput(f.content+extra,f.understanding);
 assert.deepEqual(Object.keys(payload),['allowedRuleDecisions','validatedFacts']);
 assert.ok(!JSON.stringify(payload).includes(extra));
 assert.equal(payload.validatedFacts[0].evidence.context,f.content);
 assert.ok(rewriteInstructions.includes('attaching an ID does not license additional details'));
});
