import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceLanguage} from '../src/lib/processing/source-language';
test('Arabic and Persian retain existing positive detection',()=>{
 assert.equal(sourceLanguage('قال الوزير إن الاجتماع سيعقد في العاصمة.'),'ar');
 assert.equal(sourceLanguage('او گفته که در جلسه حضور داشته است.'),'fa');
 assert.equal(sourceLanguage('او گفته که در جلسه حضور داشته است. https://example.com/news @channel'),'fa');
});
test('English uses script and multiple distinct grammatical markers, case insensitive',()=>{
 for(const text of ['The council has approved a proposal for debate.','THE MEMBERS WERE NOT INFORMED OF THE DECISION.','Officials said that they will meet on Monday.'])assert.equal(sourceLanguage(text),'en');
});
test('ambiguous and mixed text is held without guessing',()=>{
 for(const text of ['', '12345', 'Budget proposal', 'the the the the','Bonjour tout le monde','The minister قال إن الاجتماع في العاصمة.','او گفته که در جلسه است. The meeting is over.'])assert.equal(sourceLanguage(text),'unknown');
});
test('detection leaves source text unchanged',()=>{
 const original='The council has approved the proposal.\nhttps://example.com/news';const copy=original;
 assert.equal(sourceLanguage(original),'en');assert.equal(original,copy);
});
