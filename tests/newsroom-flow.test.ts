import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSourceCoverage} from '../src/lib/processing/direct-publication';
import {adaptDirectExtraction,validateDirectExtraction} from '../src/lib/processing/direct';
import {finalizeBodyPunctuation} from '../src/lib/publication-finalization';
const fixture=JSON.parse(readFileSync('tests/fixtures/coverage-connector.json','utf8'));
for(const [i,output] of fixture.outputs.entries())test(`stored production extraction ${i+1}: conjunction between exact evidence spans is not a missing fact`,()=>{
 const {coverage,publication,...extraction}=output;void publication;
 const u=adaptDirectExtraction(validateDirectExtraction(extraction,fixture.source),fixture.source);
 assert.doesNotThrow(()=>validateSourceCoverage(fixture.source,u,coverage));
 // A model cannot cover factual prose merely by citing an ID or its context.
 assert.throws(()=>validateSourceCoverage(fixture.source,u,[{unitId:'u1',factIds:['f1'],nonFactual:false}]),/DIRECT_MATERIAL_COVERAGE_FAILED/);
});
for(const omitted of ['وليس','ولكن','وقد','غداً','لم','ربما'])test(`uncovered material qualifier ${omitted} still fails closed`,()=>{
 const o=structuredClone(fixture.outputs[0]);
 const source=fixture.source.replace('، والعملية',`، ${omitted} العملية`);
 for(const s of o.statements){s.evidence.context=source;s.speaker.context=source;}
 for(const a of [...o.actors,o.action,o.object,o.location])if(a)a.context=source;
 const {coverage,publication,...extraction}=o;void publication;
 const u=adaptDirectExtraction(validateDirectExtraction(extraction,source),source);
 assert.throws(()=>validateSourceCoverage(source,u,coverage),/DIRECT_MATERIAL_COVERAGE_FAILED/);
});
for(const [input,expected] of [['خبر واضح','خبر واضح.'],['خبر واضح.','خبر واضح.'],['قال «خبر واضح»','قال «خبر واضح».'],['قال «خبر واضح.»','قال «خبر واضح.»'],['خبر (للتوضيح)','خبر (للتوضيح).'],['هل اكتمل؟','هل اكتمل؟']])test('final punctuation preserves literal copy: '+input,()=>assert.equal(finalizeBodyPunctuation(input),expected));
