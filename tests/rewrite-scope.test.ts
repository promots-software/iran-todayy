import test from 'node:test';
import assert from 'node:assert/strict';
import {editDraft} from '../src/lib/processing/editorial';
import {rewriteInstructions,scopePreservationInstructions,attributionInstructions} from '../src/lib/processing/rewrite-contract';
import {fixture,official} from './fixtures/processing';

function claim(){
 const text='قال المتحدث إن أعضاء الفريق لم يتلقوا إشعاراً.';
 const f=fixture('scope',text,'ar',text);
 f.understanding.seriousClaim=true;
 f.understanding.rankUnverified=true;
 f.understanding.event.facts[0].kind='CLAIM';
 f.understanding.event.facts[0].verified=false;
 return f;
}
test('grounded attributed draft retains review flags without attribution failure',()=>{
 const f=claim();
 const d=editDraft(f.draft,f.content,f.understanding,{...official,verified:false});
 const codes=d.review.map(r=>r.code);
 for(const code of ['UNVERIFIED_SOURCE','SERIOUS_CLAIM','RANK_UNVERIFIED'])assert.ok(codes.includes(code as typeof codes[number]));
 assert.ok(!codes.includes('UNSUPPORTED_OUTPUT'));
 assert.deepEqual(d.sentenceEvidence,[
  {text:'قال المتحدث إن أعضاء الفريق لم يتلقوا إشعاراً.',factIds:['scope:visit']},
  {text:'قال المتحدث إن أعضاء الفريق لم يتلقوا إشعاراً',factIds:['scope:visit']},
 ]);
 assert.ok(d.sentenceEvidence.some(s=>s.text===d.title));
});
test('colon-only attribution still fails the unchanged serious-claim validator',()=>{
 const f=claim();f.draft.title='المتحدث: أعضاء الفريق لم يتلقوا إشعاراً';
 f.draft.sentences.unshift({text:f.draft.title,factIds:[f.understanding.event.facts[0].id]});
 const d=editDraft(f.draft,f.content,f.understanding,official);
 assert.ok(d.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'&&r.detail==='النسب الصريح مطلوب في العنوان والمتن'));
});
test('scope and attribution requirements reach the shared rewrite prompt',()=>{
 assert.ok(rewriteInstructions.includes(scopePreservationInstructions));
 assert.ok(rewriteInstructions.includes(attributionInstructions));
 for(const restriction of ['Do not resolve pronouns or possessives','same factual scope','affected audience','never announced, disclosed or known generally','headline compression must not broaden scope','attestation false'])assert.ok(scopePreservationInstructions.includes(restriction));
 assert.ok(attributionInstructions.includes('both title and body'));
 assert.ok(attributionInstructions.includes('colon does not satisfy'));
});
