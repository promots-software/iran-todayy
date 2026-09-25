import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
function resolve(source:string,excerpt:string,context=source,startOffset=999,endOffset=1000){const e={excerpt,context,startOffset,endOffset};resolveContextEvidence(e,source);return e as unknown as {excerpt:string;start:number;end:number};}
test('captured invalid offsets remain fail closed',()=>{const s='أقر البرلمان الإيراني قانوناً جديداً لتنظيم النقل العام في إيران.';assert.throws(()=>resolve(s,'إيران',s,58,63),/AMBIGUOUS/);});
test('two standalone occurrences stay ambiguous',()=>assert.throws(()=>resolve('الإيراني إيران ثم إيران','إيران'),/AMBIGUOUS/));
test('narrow context keeps exact selection',()=>assert.equal(resolve('إيران ثم إيران','إيران','ثم إيران').start,9));
test('explicit embedded range remains valid',()=>assert.equal(resolve('الإيراني إيران','إيران','الإيراني إيران',2,7).start,2));
test('wrong context cannot enable boundary fallback',()=>assert.throws(()=>resolve('الإيراني إيران','إيران','سياق آخر'),/AMBIGUOUS/));
test('non-containing context cannot redirect',()=>assert.throws(()=>resolve('الإيراني إيران كلام','إيران','كلام'),/AMBIGUOUS/));
test('absent excerpt remains invalid',()=>assert.throws(()=>resolve('إيران','العراق'),/INVALID_EVIDENCE/));
for(const token of ['إيرانَ','بإيران','إيران\u200cها','إيران\u200dها','إيرانx','إيران𐐀'])test('Unicode lexical adjacency '+token,()=>{const s=token+' إيران';assert.throws(()=>resolve(s,'إيران'),/AMBIGUOUS/);});
test('non BMP prefix preserves UTF-16',()=>{const s='😀 الإيراني إيران';assert.equal(resolve(s,'إيران',s,s.lastIndexOf('إيران'),s.lastIndexOf('إيران')+5).start,s.lastIndexOf('إيران'));});
test('embedded numbers alone stay ambiguous',()=>assert.throws(()=>resolve('120 312','12'),/AMBIGUOUS/));
test('standalone number does not override ambiguous embedded matches',()=>assert.throws(()=>resolve('120 312 12','12'),/AMBIGUOUS/));
test('attached conjunction does not choose a numeric occurrence',()=>assert.throws(()=>resolve('3 طائرات و3 سفن','3'),/AMBIGUOUS/));
