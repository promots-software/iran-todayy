import test from 'node:test';
import assert from 'node:assert/strict';
import frozen from './fixtures/temporal-acceptance-boundary.json';
import envelope from './fixtures/high-8192-temporal-false-endorsement.json';
import {eventSchema} from '../src/lib/processing/contracts';
import {validatePublicationReviewProtocol} from '../src/lib/processing/direct-publication';
import {validateFidelityReceipt,validateFidelityLedger} from '../src/lib/processing/fidelity-ledger';

// Offline evidence audit only. No semantic extraction algorithm or acceptance policy.
const review=()=>validatePublicationReviewProtocol(JSON.parse(envelope.candidates[0].content.parts.filter(p=>typeof p.text==='string').map(p=>p.text).join('')),frozen.input.publication.length-1);
function completeAccounting(){const r=review();for(const i of [2,3]){const c=r.fidelityLedger!.claims[i];const first=c.components[0];first.excerpt=c.excerpt.slice(0,c.excerpt.indexOf(first.excerpt)+first.excerpt.length);}return r;}

test('frozen replay contains no independently extracted fact or coverage inventory',()=>{
 assert.deepEqual(frozen.input.facts,[]);assert.deepEqual(frozen.input.coverage,[]);
 assert(frozen.input.sourceUnits.length>0);
});
test('current fact schema has no per-proposition temporal or continuity structure',()=>{
 const fields=Object.keys(eventSchema.shape.facts.element.shape);
 assert.deepEqual(fields.sort(),['arabic','evidence','id','key','kind','material','speaker','verified'].sort());
 assert('eventTime' in eventSchema.shape); // Event-level timestamp is not contextual continuity.
});
test('both temporal interpretations originate in the same saved review response',()=>{
 const t=review().fidelityLedger!.sourceCoverage.find(x=>x.unitId==='u5')!.temporal[0];
 assert.deepEqual(t.sourceState,t.candidateState);assert.equal(t.assessment,'PRESERVED');
 assert.equal(t.sourceState.continuity,'BOUNDED');
 assert(frozen.input.originalSource.includes(t.sourceExcerpt));
 assert(frozen.input.publication.some(p=>p.text.includes(t.candidateExcerpt)));
});
test('complete accounting supplies no independent semantic signal: wrong receipt still passes',()=>{
 const r=completeAccounting();
 assert.deepEqual(r.fidelityLedger!.sourceCoverage,review().fidelityLedger!.sourceCoverage);
 assert.doesNotThrow(()=>validateFidelityReceipt(frozen.input.originalSource,frozen.input.publication,r.fidelityLedger));
 assert.doesNotThrow(()=>validateFidelityLedger(frozen.input.originalSource,frozen.input.publication,r.fidelityLedger));
});
test('a comparison detects the gap only after externally supplied semantic adjudication',()=>{
 // Explicit human test labels, NOT inferred from source by this test.
 const source={reference:'historical-context',continuationNow:'NOT_ESTABLISHED'};
 const candidate={reference:'current-context',continuationNow:'ASSERTED'};
 assert.notEqual(source.continuationNow,candidate.continuationNow);
 // Copying the reviewer interpretation onto both sides removes that signal.
 const t=review().fidelityLedger!.sourceCoverage.find(x=>x.unitId==='u5')!.temporal[0];
 assert.equal(JSON.stringify(t.sourceState),JSON.stringify(t.candidateState));
});
