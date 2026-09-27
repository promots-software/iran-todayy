import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodeCompactCanonicalReceipt,decodeCompactCanonicalGeminiReceipt} from '../src/lib/processing/gemini-canonical-wire';
import type {CanonicalCheck} from '../src/lib/processing/canonical-flow';
const historical=JSON.parse(readFileSync(new URL('./fixtures/canonical-compact-checker/historical.json',import.meta.url),'utf8')) as {id:string;currentSchema:boolean;receipt:CanonicalCheck}[];
for(const r of historical)test(`historical checker transport ${r.id}`,()=>{
 if(r.currentSchema){const wire=encodeCompactCanonicalReceipt(r.receipt);const decoded=JSON.parse(decodeCompactCanonicalGeminiReceipt(JSON.stringify(wire)));assert.deepEqual(decoded,r.receipt);assert.deepEqual(Object.entries(decoded.sections).filter(([,v])=>(v as {status:string}).status==='FAIL').map(([id])=>id),Object.entries(r.receipt.sections).filter(([,v])=>v.status==='FAIL').map(([id])=>id));}
 else{assert.throws(()=>encodeCompactCanonicalReceipt(r.receipt));}
});
test('historical corpus coverage and legacy exclusions are explicit',()=>{
 assert.equal(historical.length,349);assert.equal(historical.filter(r=>r.currentSchema).length,346);assert.equal(historical.filter(r=>!r.currentSchema).length,3);assert.equal(historical.filter(r=>r.currentSchema&&Object.values(r.receipt.sections).some(s=>s.status==='FAIL')).length,5);
});
