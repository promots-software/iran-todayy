import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import envelope from './fixtures/high-8192-temporal-false-endorsement.json';
import frozen from './fixtures/temporal-acceptance-boundary.json';
import {scoreSavedReview} from './fixtures/semantic-review-diagnostic';
import {validatePublicationReviewProtocol,preparePublication,acceptPublication} from '../src/lib/processing/direct-publication';
import {validateFidelityReceipt,validateFidelityLedger} from '../src/lib/processing/fidelity-ledger';
import {sourceUnits} from '../src/lib/processing/source-units';
import {understandingSchema} from '../src/lib/processing/contracts';
import {recoverReview} from '../src/lib/processing/review-recovery';
import {protectReceipt,receiptRepairCores} from '../src/lib/processing/receipt-preservation';
import {fidelityRepairDiagnostics} from '../src/lib/processing/repair-diagnostics';
import {supportedLedger} from './fixtures/fidelity-review';
const {originalSource:source,publication}=frozen.input;
const raw=()=>JSON.parse(envelope.candidates[0].content.parts.filter(p=>typeof p.text==='string').map(p=>p.text).join(''));
const parsed=()=>validatePublicationReviewProtocol(raw(),publication.length-1);
/** Counterfactual ONLY: account for the two attribution frames. No semantic
 * finding, source link, original component, candidate or temporal state changes. */
function accountingOnly(){const r=parsed();for(const [index,excerpt] of [[2,'وأوضح المتحدث أن'],[3,'وأشار إلى أن']] as const){const parent=r.fidelityLedger!.claims[index];parent.components.push({id:'offline-frame-'+index,excerpt,sourceUnitIds:[...parent.sourceUnitIds],verdict:'SUPPORTED',explanation:'Test-only accounting of the already attributed reporting frame; not a provider response.'});}return r;}
/** Test-only source-grounded acceptance prerequisites. Frozen live review had
 * facts=[]/coverage=[]; these are NOT claimed to be a historical extraction. */
function acceptanceContext(){
 const units=sourceUnits(source);const facts=units.map((u,i)=>({id:'f'+(i+1),key:u.id,arabic:u.text,evidence:{excerpt:u.text,start:u.start,end:u.end},kind:'FACT',material:true,speaker:null,verified:false}));
 const u=understandingSchema.parse({language:'ar',relevance:'POLITICAL_NEWS',filterReason:'NONE',topic:'IRAN_DOMESTIC',priority:'P2',rationale:'سياق اختبار مستقل مبني على النص الأصلي',event:{actors:[],action:null,object:null,location:null,eventTime:null,facts,summary:'سياق اختبار القبول'},names:[],sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,uncoveredTerms:[]});
 const ids=(...indices:number[])=>indices.map(i=>facts[i].id);
 const proposal={title:{text:publication[0].text,factIds:ids(0,1)},body:publication.slice(1).map((p,i)=>({text:p.text,factIds:i===0?ids(0,2):i===1?ids(1):ids(3)}))};
 const coverage=units.map((unit,i)=>({unitId:unit.id,nonFactual:false,factIds:ids(i)}));
 return {u,prepared:preparePublication(source,u,proposal,coverage,true)};
}
test('exact provider envelope remains byte-frozen',()=>{assert.equal(createHash('sha256').update(readFileSync('tests/fixtures/high-8192-temporal-false-endorsement.json')).digest('hex'),frozen.responseSHA256);assert.equal(envelope.candidates[0].finishReason,'STOP');});
test('semantic FALSE ENDORSEMENT stays visible independently of unrelated receipt failure',t=>{
 const result=scoreSavedReview(source,publication,raw(),'UNSUPPORTED');t.diagnostic(JSON.stringify(result));assert.deepEqual(result,{semanticExpected:'UNSUPPORTED',semanticObserved:'SUPPORTED',semanticCorrect:false,receiptValid:false,receiptFailureReason:'INCOMPLETE_COMPONENT_ACCOUNTING',receiptFailurePath:['fidelityLedger','claims',2,'components']});
});
test('accounting-only counterfactual preserves every existing semantic finding',()=>{const before=parsed(),after=accountingOnly();const restore=structuredClone(after);restore.fidelityLedger!.claims[2].components.pop();restore.fidelityLedger!.claims[3].components.pop();assert.deepEqual(restore,before);assert.deepEqual(after.fidelityLedger!.claims[1],before.fidelityLedger!.claims[1]);assert.deepEqual(after.fidelityLedger!.sourceCoverage,before.fidelityLedger!.sourceCoverage);});
test('KNOWN GAP: complete-accounting coherent-but-wrong receipt passes current fidelity boundary',t=>{const result=scoreSavedReview(source,publication,accountingOnly(),'UNSUPPORTED');assert.equal(result.semanticCorrect,false);assert.equal(result.receiptValid,true);assert.doesNotThrow(()=>validateFidelityLedger(source,publication,accountingOnly().fidelityLedger));t.diagnostic('KNOWN SEMANTIC GAP: receipt acceptance is not semantic truth; this test records a vulnerability, not safety success.');});
test('KNOWN GAP: current acceptPublication accepts accounting-only counterfactual with grounded test prerequisites',t=>{const {u,prepared}=acceptanceContext();assert.throws(()=>acceptPublication(source,u,prepared,raw()),/REVIEW_RECEIPT_INVALID/);const receipt=acceptPublication(source,u,prepared,accountingOnly());assert.equal(receipt.method,'INDEPENDENT');assert.equal(receipt.proposal.body[0].text,publication[1].text);t.diagnostic('ACCEPTED by real acceptPublication; no delivery/policy/database invoked; extraction prerequisites are explicitly test-only.');});
for(const [i,frame] of [[2,'وأوضح المتحدث أن'],[3,'وأشار إلى أن']] as const)test('reporting frame must be accounted: '+frame,()=>{const r=accountingOnly();r.fidelityLedger!.claims[i].components.pop();assert.throws(()=>validateFidelityReceipt(source,publication,r.fidelityLedger),/REVIEW_RECEIPT_INVALID/);});
test('reporting frames can be included in larger exact components without word fragmentation',()=>{const r=parsed();for(const i of [2,3]){const c=r.fidelityLedger!.claims[i];c.components[0].excerpt=c.excerpt.slice(0,c.excerpt.indexOf(c.components[0].excerpt)+c.components[0].excerpt.length);}assert.doesNotThrow(()=>validateFidelityReceipt(source,publication,r.fidelityLedger));});
type State={time:'PAST'|'PRESENT'|'FUTURE';phase:'PLANNED'|'OCCURRING'|'COMPLETED';continuity:'UNSPECIFIED'|'CONTINUING'|'BOUNDED';certainty:'ASSERTED'|'POSSIBLE'};
const state=(time:State['time'],phase:State['phase'],continuity:State['continuity']='UNSPECIFIED',certainty:State['certainty']='ASSERTED'):State=>({time,phase,continuity,certainty});
const matrix=[
 {name:'past activity to current continuation',source:'كانت اللجنة تناقش المشروع.',candidate:'تواصل اللجنة مناقشة المشروع الآن.',a:state('PAST','OCCURRING'),b:state('PRESENT','OCCURRING','CONTINUING'),negative:true},
 {name:'completed to ongoing',source:'اكتملت الأعمال.',candidate:'العمل يجري الآن.',a:state('PAST','COMPLETED'),b:state('PRESENT','OCCURRING'),negative:true},
 {name:'planned to completed',source:'سيبدأ العمل غداً.',candidate:'اكتمل العمل.',a:state('FUTURE','PLANNED'),b:state('PAST','COMPLETED'),negative:true},
 {name:'possible to asserted',source:'قد يبدأ العمل.',candidate:'بدأ العمل.',a:state('FUTURE','PLANNED','UNSPECIFIED','POSSIBLE'),b:state('PAST','COMPLETED'),negative:true},
 {name:'subordinate historical context to current continuation',source:'جرت الجولة في إطار المحادثات التي كانت تتم عبر الوسطاء.',candidate:'جرت الجولة في إطار المحادثات المستمرة التي تجري عبر الوسطاء.',a:state('PAST','OCCURRING'),b:state('PRESENT','OCCURRING','CONTINUING'),negative:true},
 {name:'source establishes current continuation',source:'المحادثات مستمرة الآن.',candidate:'تتواصل المحادثات حالياً.',a:state('PRESENT','OCCURRING','CONTINUING'),b:state('PRESENT','OCCURRING','CONTINUING'),negative:false},
 {name:'journalistic present reports completed event',source:'أقر البرلمان القانون أمس.',candidate:'البرلمان يقر القانون الذي أقره أمس.',a:state('PAST','COMPLETED','BOUNDED'),b:state('PAST','COMPLETED','BOUNDED'),negative:false},
 {name:'faithful past-progressive paraphrase',source:'كانت اللجنة تناقش المشروع.',candidate:'كانت مناقشة المشروع تجري في اللجنة.',a:state('PAST','OCCURRING'),b:state('PAST','OCCURRING'),negative:false},
];
for(const c of matrix)test('adjudicated temporal matrix: '+c.name,()=>{const p=[{id:'title',text:c.candidate}],l=supportedLedger(c.source,p);Object.assign(l.sourceCoverage[0].temporal[0],{sourceState:c.a,candidateState:c.b,assessment:c.negative?'CHANGED':'PRESERVED'});if(c.negative){Object.assign(l.claims[0],{verdict:'UNSUPPORTED'});l.claims[0].components[0].verdict='UNSUPPORTED';}assert.doesNotThrow(()=>validateFidelityReceipt(c.source,p,l));if(c.negative)assert.throws(()=>validateFidelityLedger(c.source,p,l),/INDEPENDENT_FIDELITY_FAILED/);else assert.doesNotThrow(()=>validateFidelityLedger(c.source,p,l));});
test('main-event row cannot substitute for missing contextual temporal review',()=>{const r=accountingOnly(),context=r.fidelityLedger!.sourceCoverage.find(x=>x.unitId==='u5')!;context.temporal=[];assert.throws(()=>validateFidelityReceipt(source,publication,r.fidelityLedger),/REVIEW_RECEIPT_INVALID/);});
test('independently adjudicated contextual states reject drift even when main event is unchanged',()=>{const r=accountingOnly(),l=r.fidelityLedger!;const main=structuredClone(l.sourceCoverage[0]);const t=l.sourceCoverage.find(x=>x.unitId==='u5')!.temporal[0];Object.assign(t,{sourceState:state('PAST','OCCURRING'),candidateState:state('PRESENT','OCCURRING','CONTINUING'),assessment:'CHANGED'});l.claims[1].components[1].verdict='UNSUPPORTED';l.claims[1].verdict='UNSUPPORTED';assert.deepEqual(l.sourceCoverage[0],main);assert.doesNotThrow(()=>validateFidelityReceipt(source,publication,l));assert.throws(()=>validateFidelityLedger(source,publication,l),/INDEPENDENT_FIDELITY_FAILED/);});
for(const saved of frozen.recoveries)test('saved constrained recovery: '+saved.id,async()=>{const context={originalSource:saved.input.originalSource,publication:saved.input.publication};const validate=(raw:unknown)=>{const v=validatePublicationReviewProtocol(raw,context.publication.length-1);validateFidelityReceipt(context.originalSource,context.publication,v.fidelityLedger);return v;};let calls=0;const run=()=>recoverReview(async correction=>{calls++;return structuredClone(correction?saved.corrected:saved.initial);},validate,()=>{},()=>true,context);if(saved.id==='date-changed'){const initial=protectReceipt(saved.initial,context);const v=await run();assert.throws(()=>validateFidelityLedger(context.originalSource,context.publication,v.fidelityLedger),/INDEPENDENT_FIDELITY_FAILED/);assert(initial.negative.length>0);for(const core of receiptRepairCores(v,context)??[])assert(initial.negative.some(n=>n.publicationId===core.publicationId&&core.start>=n.start&&core.end<=n.end));}else await assert.rejects(run(),/REVIEW_RECEIPT_INVALID/);assert.equal(calls,2);});
test('receipt-only defect cannot authorize article R1/R2',()=>{const {u,prepared}=acceptanceContext();assert.deepEqual(fidelityRepairDiagnostics(parsed().fidelityLedger,source,u,{publication:prepared.proposal,coverage:prepared.coverage}),[]);});
