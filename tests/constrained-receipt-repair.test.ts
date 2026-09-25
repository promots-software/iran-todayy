import test from 'node:test';
import assert from 'node:assert/strict';
import b1 from './fixtures/high-thinking-b1.json';
import b2 from './fixtures/high-thinking-b2.json';
import b3 from './fixtures/high-thinking-b3.json';
import {recoverReview} from '../src/lib/processing/review-recovery';
import {protectReceipt,preserveReceipt,receiptRepairCores} from '../src/lib/processing/receipt-preservation';
import {validatePublicationReviewProtocol} from '../src/lib/processing/direct-publication';
import {validateFidelityReceipt,validateFidelityLedger} from '../src/lib/processing/fidelity-ledger';
import {fidelityRepairDiagnostics} from '../src/lib/processing/repair-diagnostics';
import {scopePreserved} from '../src/lib/processing/targeted-repair';
import {fixture} from './fixtures/processing';
const source='أقر البرلمان الإيراني قانوناً جديداً لتنظيم النقل العام في إيران.';
const title='البرلمان الإيراني يقر قانوناً جديداً لتنظيم النقل العام';
const body='أقر البرلمان الإيراني قانوناً جديداً يهدف إلى تنظيم وتطوير قطاع النقل العام في البلاد.';
const context={originalSource:source,publication:[{id:'title',text:title},{id:'body:1',text:body}]};
const copies=[b1,b2,b3];
function corrected(n=1){const x=structuredClone(copies[n-1]);const claim=x.fidelityLedger.claims[1];claim.components.push({id:'tail',excerpt:n===1?'في البلاد':'قطاع النقل العام في البلاد',sourceUnitIds:['u1'],verdict:'SUPPORTED',explanation:'Offline semantic fixture: the transport object and Iran reference are supported.'});for(const t of x.fidelityLedger.sourceCoverage[0].temporal)t.assessment='PRESERVED';return x;}
function validate(raw:unknown){const x=validatePublicationReviewProtocol(raw,1);validateFidelityReceipt(source,context.publication,x.fidelityLedger);return x;}
async function recover(initial:unknown,output:unknown){let calls=0;const value=await recoverReview(async correction=>{calls++;if(correction)assert(correction.protectedFindings);return structuredClone(correction?output:initial);},validate,()=>{},()=>true,context);assert.equal(calls,2);return value;}
function check(initial:unknown,output:unknown){const value=validate(output);preserveReceipt(protectReceipt(initial,context),output,context,value);return value;}
function negative(x:ReturnType<typeof corrected>){return x.fidelityLedger.claims[1].components.find(c=>c.verdict==='UNSUPPORTED')!;}
for(let n=1;n<=3;n++)test('exact B'+n+' corrected accounting preserves rejection and narrow article authority',async()=>{
 const initial=copies[n-1];assert.throws(()=>validate(initial),/REVIEW_RECEIPT_INVALID/);
 const fixed=corrected(n),value=await recover(initial,fixed);assert.throws(()=>validateFidelityLedger(source,context.publication,value.fidelityLedger),/INDEPENDENT_FIDELITY_FAILED/);
 const candidate={publication:{title:{text:title},body:[{text:body}]}},u=fixture('receipt',source).understanding;
 const ds=fidelityRepairDiagnostics(value.fidelityLedger,source,u,candidate);assert.equal(ds.length,1);
 const good=structuredClone(candidate);good.publication.body[0].text=body.replace('وتطوير','');assert(scopePreserved(candidate,good,ds));
 const bad=structuredClone(candidate);bad.publication.body[0].text=body.replace('في البلاد','في مدينة أخرى');assert(!scopePreserved(candidate,bad,ds));
});
for(const mode of ['same supported','omitted','broader supported','weaken to uncertain','source link'])test('protected unsupported rejects '+mode,()=>{
 const initial=b2,x=corrected(2),claim=x.fidelityLedger.claims[1];
 if(mode==='omitted')claim.components=claim.components.filter(c=>c.id!=='c4');
 else if(mode==='broader supported')claim.components=[{...claim.components[0],excerpt:body,verdict:'SUPPORTED'}];
 else if(mode==='source link')negative(x).sourceUnitIds=['u999'];
 else negative(x).verdict=mode==='weaken to uncertain'?'UNCERTAIN':'SUPPORTED';
 claim.verdict=mode==='weaken to uncertain'?'UNCERTAIN':mode==='source link'?'UNSUPPORTED':'SUPPORTED';
 assert.throws(()=>check(initial,x));
});
for(const [before,after,allowed] of [['UNCERTAIN','SUPPORTED',false],['SUPPORTED','UNSUPPORTED',true],['SUPPORTED','UNCERTAIN',true],['UNCERTAIN','UNSUPPORTED',true]] as const)test(before+' to '+after,()=>{
 const initial=structuredClone(b2);initial.fidelityLedger.claims[1].components[2].verdict=before;initial.fidelityLedger.claims[1].verdict=before;
 const x=corrected(2);negative(x).verdict=after;x.fidelityLedger.claims[1].verdict=after;
 if(allowed)assert.doesNotThrow(()=>check(initial,x));else assert.throws(()=>check(initial,x),/REVIEW_RECEIPT_INVALID/);
});
test('malformed initial identity is not frozen',()=>{const initial=structuredClone(b2);initial.fidelityLedger.claims[1].components[2].excerpt='not in candidate';assert.equal(protectReceipt(initial,context).negative.length,0);const x=corrected(2);negative(x).verdict='SUPPORTED';x.fidelityLedger.claims[1].verdict='SUPPORTED';assert.doesNotThrow(()=>check(initial,x));});
test('changed IDs retain negative span identity',()=>{const x=corrected(2);negative(x).id='renamed';assert.doesNotThrow(()=>check(b2,x));});
test('split negative span preserves every character',()=>{const x=corrected(2),claim=x.fidelityLedger.claims[1],part=negative(x);claim.components=claim.components.filter(c=>c!==part);claim.components.push({...part,id:'split1',excerpt:'وتط'},{...part,id:'split2',excerpt:'وير'});assert.doesNotThrow(()=>check(b2,x));});
for(const n of [1,2,3])test('B'+n+' merged accounting never expands repair core',()=>{
 const x=corrected(n),claim=x.fidelityLedger.claims[1],part=negative(x),start=body.indexOf(part.excerpt);claim.components=claim.components.filter(c=>c.id!=='tail');part.excerpt=body.slice(start);part.id='merged';const value=check(copies[n-1],x);const cores=receiptRepairCores(value.fidelityLedger,context)!;assert(cores.length);assert(cores.every(c=>c.end<=body.indexOf('في البلاد')));if(n>1)assert(cores.every(c=>body.slice(c.start,c.end)==='وتطوير'));
 const candidate={publication:{title:{text:title},body:[{text:body}]}},ds=fidelityRepairDiagnostics(value.fidelityLedger,source,fixture('merged',source).understanding,candidate);const changed=structuredClone(candidate);changed.publication.body[0].text=body.replace('في البلاد','في الخارج');assert(!scopePreserved(candidate,changed,ds));
});
for(const kind of ['phase','certainty','ongoing'] as const)test('coherent temporal negative cannot be relaxed '+kind,()=>{
 const initial=structuredClone(b1),t=initial.fidelityLedger.sourceCoverage[0].temporal[1];t.candidateExcerpt=initial.fidelityLedger.claims[1].components[1].excerpt;t.assessment='CHANGED';
 if(kind==='phase'){t.sourceState.phase='PLANNED';t.candidateState.phase='COMPLETED';}else if(kind==='certainty'){t.sourceState.certainty='POSSIBLE';t.candidateState.certainty='ASSERTED';}else{t.sourceState.phase='COMPLETED';t.candidateState.phase='OCCURRING';}
 const protectedSet=protectReceipt(initial,context);assert.equal(protectedSet.temporal.length,1);
 const x=corrected(1);assert.throws(()=>check(initial,x),/REVIEW_RECEIPT_INVALID/);x.fidelityLedger.sourceCoverage[0].temporal[1]=structuredClone(t);assert.doesNotThrow(()=>check(initial,x));
});
test('B3 incoherent temporal changed is mutable but component rejection survives',()=>{assert.equal(protectReceipt(b3,context).temporal.length,0);assert.doesNotThrow(()=>check(b3,corrected(3)));const x=corrected(3);negative(x).verdict='SUPPORTED';x.fidelityLedger.claims[1].verdict='SUPPORTED';assert.throws(()=>check(b3,x));});
test('correction is bounded and failure cannot return an accepted receipt',async()=>{const x=corrected(2);negative(x).verdict='SUPPORTED';x.fidelityLedger.claims[1].verdict='SUPPORTED';let calls=0;await assert.rejects(recoverReview(async c=>{calls++;return c?x:b2;},validate,()=>{},()=>true,context),/REVIEW_RECEIPT_INVALID/);assert.equal(calls,2);});
test('checkpoint JSON replay reconstructs local authority; model JSON cannot supply it',async()=>{const first=await recover(b2,corrected(2));assert(receiptRepairCores(first,context));const serialized=JSON.parse(JSON.stringify(first));assert.equal(receiptRepairCores(serialized,context),undefined);const replay=await recover(JSON.parse(JSON.stringify(b2)),JSON.parse(JSON.stringify(corrected(2))));assert.deepEqual(receiptRepairCores(first,context),receiptRepairCores(replay,context));});
test('scope authority survives protocol parse and rejects different source context',async()=>{const x=await recover(b2,corrected(2)),parsed=validatePublicationReviewProtocol(x,1);assert(receiptRepairCores(parsed,context));assert.throws(()=>receiptRepairCores(parsed,{...context,originalSource:source+'changed'}),/REVIEW_RECEIPT_INVALID/);});
test('new negative accounting tail cannot enlarge existing article repair authority',()=>{const x=corrected(2);x.fidelityLedger.claims[1].components.find(c=>c.id==='tail')!.verdict='UNSUPPORTED';const value=check(b2,x);assert(receiptRepairCores(value,context)!.every(c=>body.slice(c.start,c.end)==='وتطوير'));});
test('supported component overlapping a preserved negative cannot swallow it',()=>{const x=corrected(2);x.fidelityLedger.claims[1].components.push({id:'swallow',excerpt:body,sourceUnitIds:['u1'],verdict:'SUPPORTED',explanation:'Adversarial contradictory support.'});assert.throws(()=>check(b2,x),/REVIEW_RECEIPT_INVALID/);});
test('unidentifiable repeated candidate occurrences acquire no frozen authority',()=>{const c={originalSource:source,publication:[{id:'body:1',text:body+' '+body}]};assert.equal(protectReceipt(b2,c).negative.length,0);});