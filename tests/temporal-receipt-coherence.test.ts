import test from 'node:test';import assert from 'node:assert/strict';
import legacy from './fixtures/case1-temporal-receipts.json';
import {componentFixture} from './fixtures/fidelity-review';
const saved={...legacy,'5':{...legacy['5'],fidelityLedger:componentFixture(legacy['5'].fidelityLedger)},'6':{...legacy['6'],fidelityLedger:componentFixture(legacy['6'].fidelityLedger)},'8':{...legacy['8'],fidelityLedger:componentFixture(legacy['8'].fidelityLedger)}};
import {validateFidelityReceipt,validateFidelityLedger} from '../src/lib/processing/fidelity-ledger';
import {fidelityRepairDiagnostics} from '../src/lib/processing/repair-diagnostics';
import {recoverReview} from '../src/lib/processing/review-recovery';
import {normalStage} from '../src/lib/processing/normal-v2';
import {fixture} from './fixtures/processing';
const source='أقر البرلمان الإيراني قانوناً جديداً لتنظيم النقل العام في إيران.';
const title='إيران الآن | البرلمان الإيراني يقر قانوناً جديداً لتنظيم النقل العام';
const body='أقر البرلمان الإيراني قانوناً جديداً لتنظيم النقل العام في البلاد.';
const initial='أقر البرلمان الإيراني قانوناً جديداً يهدف إلى تنظيم وتطوير قطاع النقل العام في البلاد.';
const pub=(b=body)=>[{id:'title',text:title},{id:'body:1',text:b}];
const candidate=(b=body)=>({publication:{title:{text:title},body:[{text:b}]}});
function coherent(){const l=structuredClone(saved['8'].fidelityLedger);l.sourceCoverage[0].temporal[0]=structuredClone(saved['6'].fidelityLedger.sourceCoverage[0].temporal[0]);return l;}
for(const n of ['5','8'] as const)test('saved request '+n+' is receipt error, no article diagnosis',()=>{const p=pub(n==='5'?initial:body);assert.throws(()=>validateFidelityReceipt(source,p,saved[n].fidelityLedger),/REVIEW_RECEIPT_INVALID/);assert.deepEqual(fidelityRepairDiagnostics(saved[n].fidelityLedger,source,fixture('case',source).understanding,candidate(n==='5'?initial:body)),[]);});
test('request6 receipt valid but genuine development addition still repairable',()=>{assert.doesNotThrow(()=>validateFidelityReceipt(source,pub(initial),saved['6'].fidelityLedger));assert.throws(()=>validateFidelityLedger(source,pub(initial),saved['6'].fidelityLedger),/INDEPENDENT_FIDELITY_FAILED/);assert(fidelityRepairDiagnostics(saved['6'].fidelityLedger,source,fixture('case',source).understanding,candidate(initial)).length);});
test('completed event journalistic present without yesterday passes',()=>{assert.doesNotThrow(()=>validateFidelityLedger(source,pub(),coherent()));assert.deepEqual(fidelityRepairDiagnostics(coherent(),source,fixture('case',source).understanding,candidate()),[]);});
for(const allowed of [true,false])test('receipt recovery available '+allowed+' cannot spend article repair',async()=>{let calls=0,repairs=0;const run=()=>normalStage('draft',()=>recoverReview(async correction=>{calls++;return correction?coherent():saved['8'].fidelityLedger;},r=>validateFidelityReceipt(source,pub(),r),()=>{},()=>allowed),source,undefined,()=>{repairs++;return true;});if(allowed)await run();else await assert.rejects(run(),/REVIEW_RECEIPT_INVALID/);assert.equal(repairs,0);assert.equal(calls,allowed?2:1);});
test('genuine changed aspect may coexist with separate supported claim',()=>{const l=structuredClone(saved['8'].fidelityLedger);Object.assign(l.claims[0],{verdict:'UNSUPPORTED'});l.claims[0].components[0].verdict='UNSUPPORTED';l.claims[0].explanation='Explicit semantic fixture: changed activity temporal state.';assert.doesNotThrow(()=>validateFidelityReceipt(source,pub(),l));assert.throws(()=>validateFidelityLedger(source,pub(),l),/INDEPENDENT_FIDELITY_FAILED/);assert(fidelityRepairDiagnostics(l,source,fixture('case',source).understanding,candidate()).length);assert.equal(l.claims[1].verdict,'SUPPORTED');});

import {supportedLedger} from './fixtures/fidelity-review';
import {temporalStateSchema} from '../src/lib/processing/fidelity-ledger-contract';
const state=(time:'PAST'|'PRESENT'|'FUTURE',phase:'COMPLETED'|'OCCURRING'|'PLANNED',continuity:'BOUNDED'|'CONTINUING'|'UNSPECIFIED'='UNSPECIFIED',certainty:'ASSERTED'|'POSSIBLE'='ASSERTED')=>({time,phase,continuity,certainty});
for(const [name,s,c,a,b] of [
 ['now','اكتملت الأعمال.','العمل يجري الآن.',state('PAST','COMPLETED'),state('PRESENT','OCCURRING')],
 ['continuing','انتهت المحادثات.','المحادثات مستمرة حالياً.',state('PAST','COMPLETED'),state('PRESENT','OCCURRING','CONTINUING')],
 ['planned','سيبدأ العمل غداً.','اكتمل العمل.',state('FUTURE','PLANNED'),state('PAST','COMPLETED')],
 ['possible','قد يبدأ العمل.','بدأ العمل.',state('FUTURE','PLANNED','UNSPECIFIED','POSSIBLE'),state('PAST','COMPLETED')],
 ['ongoing','العمل جارٍ.','انتهى العمل.',state('PRESENT','OCCURRING'),state('PAST','COMPLETED')],
 ['recorded strengthening','المحادثات التي كانت تتم','المحادثات المستمرة التي تجري',state('PAST','OCCURRING'),state('PRESENT','OCCURRING','CONTINUING')]
] as const)test('coherent material temporal change '+name,()=>{const p=[{id:'title',text:c}],l=supportedLedger(s,p);Object.assign(l.sourceCoverage[0].temporal[0],{sourceState:a,candidateState:b,assessment:'CHANGED'});Object.assign(l.claims[0],{verdict:'UNSUPPORTED'});l.claims[0].components[0].verdict='UNSUPPORTED';l.claims[0].explanation='Material state differs for this exact proposition.';assert.doesNotThrow(()=>validateFidelityReceipt(s,p,l));assert.throws(()=>validateFidelityLedger(s,p,l),/INDEPENDENT_FIDELITY_FAILED/);});
test('semantic field descriptions survive into schema',()=>{for(const field of Object.values(temporalStateSchema.shape))assert(field.description?.includes('Semantic'));});
