import {componentFixture} from './fixtures/fidelity-review';
import test from 'node:test';
import assert from 'node:assert/strict';
import {supportedLedger} from './fixtures/fidelity-review';
import {validateFidelityLedger,temporalReviewInstructions} from '../src/lib/processing/fidelity-ledger';
import {temporalComparisonSchema} from '../src/lib/processing/fidelity-ledger-contract';
import providerControls from './fixtures/temporal-evidence-provider-controls.json';
import {sourceUnits} from '../src/lib/processing/source-units';

const source='ذكرت اللجنة أن أعمال البناء اكتملت الأسبوع الماضي.';
const publication=[{id:'title',text:'اللجنة تعلن انتهاء أعمال البناء خلال الأسبوع الماضي'}];
function faithful(){
 const ledger=supportedLedger(source,publication),t=ledger.sourceCoverage[0].temporal[0];
 Object.assign(t,{sourceExcerpt:'أعمال البناء اكتملت الأسبوع الماضي',candidateExcerpt:'انتهاء أعمال البناء خلال الأسبوع الماضي',sourceState:{time:'PAST',phase:'COMPLETED',continuity:'BOUNDED',certainty:'ASSERTED'},candidateState:{time:'PAST',phase:'COMPLETED',continuity:'BOUNDED',certainty:'ASSERTED'}});
 return ledger;
}
for(const ellipsis of ['...','…']){
 test('fabricated source ellipsis '+ellipsis+' is never expanded or accepted',()=>{
  const l=faithful();l.sourceCoverage[0].temporal[0].sourceExcerpt='أعمال البناء'+ellipsis+'الأسبوع الماضي';
  assert.throws(()=>validateFidelityLedger(source,publication,l),e=>{assert.match(JSON.stringify(e),/INVALID_TEMPORAL_SOURCE/);return true;});
 });
 test('fabricated candidate ellipsis '+ellipsis+' is never expanded or accepted',()=>{
  const l=faithful();l.sourceCoverage[0].temporal[0].candidateExcerpt='انتهاء أعمال البناء'+ellipsis+'الأسبوع الماضي';
  assert.throws(()=>validateFidelityLedger(source,publication,l),e=>{assert.match(JSON.stringify(e),/INVALID_TEMPORAL_CANDIDATE/);return true;});
 });
}
test('short exact evidence accepts a conceptual temporal-equivalent rewrite',()=>{
 assert.notEqual(faithful().sourceCoverage[0].temporal[0].sourceExcerpt,faithful().sourceCoverage[0].temporal[0].candidateExcerpt);
 assert.doesNotThrow(()=>validateFidelityLedger(source,publication,faithful()));
});
test('source/candidate evidence cannot be swapped or paraphrased as evidence',()=>{
 const l=faithful(),t=l.sourceCoverage[0].temporal[0];[t.sourceExcerpt,t.candidateExcerpt]=[t.candidateExcerpt,t.sourceExcerpt];
 assert.throws(()=>validateFidelityLedger(source,publication,l),/FIDELITY|REVIEW_RECEIPT_INVALID/);
});
test('SUPPORTED/PRESERVED cannot override a structured temporal contradiction',()=>{
 const l=faithful();Object.assign(l.sourceCoverage[0].temporal[0].candidateState,{time:'PRESENT',phase:'OCCURRING'});
 assert.equal(l.claims[0].verdict,'SUPPORTED');assert.equal(l.sourceCoverage[0].temporal[0].assessment,'PRESERVED');
 assert.throws(()=>validateFidelityLedger(source,publication,l),e=>{assert.match(JSON.stringify(e),/TEMPORAL_SCOPE_CHANGE|INCONSISTENT_TEMPORAL_ASSESSMENT/);return true;});
});
test('evidence instructions distinguish exact copied spans from semantic explanation',()=>{
 for(const key of ['sourceExcerpt','candidateExcerpt'] as const){
  const d=temporalComparisonSchema.shape[key].description!;
  assert(d.includes('SHORT CONTIGUOUS EXACT'));assert(d.includes('...'));assert(d.includes('paraphrase'));
 }
 assert(temporalReviewInstructions.includes('Only explanation may paraphrase'));
 assert(!temporalReviewInstructions.includes('44213'));assert(!temporalReviewInstructions.includes('كانت تتم'));
});

for(const control of providerControls)test('actual Gemini '+control.control+' control uses valid unchanged evidence and the correct disposition',()=>{
 const units=sourceUnits(control.source);
 for(const row of control.review.fidelityLedger.sourceCoverage)for(const t of row.temporal){
  assert(units.find(u=>u.id===row.unitId)!.text.includes(t.sourceExcerpt));
  assert(control.publication.find(p=>p.id===t.publicationId)!.text.includes(t.candidateExcerpt));
 }
 if(control.control==='negative'){
  assert.throws(()=>validateFidelityLedger(control.source,control.publication,componentFixture(control.review.fidelityLedger)),e=>{assert.match(JSON.stringify(e),/TEMPORAL_SCOPE_CHANGE|INCONSISTENT_TEMPORAL_ASSESSMENT/);return true;});
 }else{
  assert(control.review.fidelityLedger.sourceCoverage.some(row=>row.temporal.some(t=>t.sourceExcerpt!==t.candidateExcerpt)));
  assert.doesNotThrow(()=>validateFidelityLedger(control.source,control.publication,componentFixture(control.review.fidelityLedger)));
 }
});
