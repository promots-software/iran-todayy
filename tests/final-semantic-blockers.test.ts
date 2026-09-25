import {componentFixture} from './fixtures/fidelity-review';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {supportedLedger} from './fixtures/fidelity-review';
import {fidelityLedgerSchema,temporalStateSchema} from '../src/lib/processing/fidelity-ledger-contract';
import {validateFidelityLedger,temporalReviewInstructions} from '../src/lib/processing/fidelity-ledger';
import {fidelityRepairDiagnostics} from '../src/lib/processing/repair-diagnostics';
import {canonicalPresentationPrefixLength} from '../src/lib/processing/newsroom-format';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
import replay from './fixtures/replay-root-cases.json';
import oldFalseAccept from './fixtures/replay-temporal-false-accept.json';
import actualTemporalReview from './fixtures/final-temporal-review.json';
import faithfulControl from './fixtures/final-temporal-control.json';
import displayAccounting from './fixtures/final-display-accounting.json';
import {AssumedPropositionGemini as GeminiLanguageProvider} from './fixtures/proposition-mock';
import {ruleSet} from '../src/lib/processing/rules';
import {fixture} from './fixtures/processing';
const state=(changes:Partial<ReturnType<typeof temporalStateSchema.parse>>={})=>temporalStateSchema.parse({time:'UNSPECIFIED',phase:'UNSPECIFIED',continuity:'UNSPECIFIED',certainty:'ASSERTED',...changes});
const pairs=[
 {name:'past to present',source:'كانت اللجنة تناقش المشروع.',candidate:'تناقش اللجنة المشروع الآن.',a:state({time:'PAST',phase:'OCCURRING'}),b:state({time:'PRESENT',phase:'OCCURRING'})},
 {name:'planned to occurring',source:'تخطط اللجنة لافتتاح المدرسة.',candidate:'تفتتح اللجنة المدرسة.',a:state({time:'FUTURE',phase:'PLANNED'}),b:state({time:'PRESENT',phase:'OCCURRING'})},
 {name:'possible to confirmed',source:'قد يبدأ العمل غداً.',candidate:'سيبدأ العمل غداً.',a:state({time:'FUTURE',certainty:'POSSIBLE'}),b:state({time:'FUTURE',certainty:'ASSERTED'})},
 {name:'completed to ongoing',source:'اكتملت المفاوضات.',candidate:'تستمر المفاوضات.',a:state({time:'PAST',phase:'COMPLETED'}),b:state({time:'PRESENT',phase:'OCCURRING',continuity:'CONTINUING'})},
 {name:'unspecified to continuing',source:'جرت المحادثات.',candidate:'المحادثات مستمرة.',a:state({time:'PAST'}),b:state({time:'PRESENT',continuity:'CONTINUING'})},
];
for(const c of pairs)test('semantic contrast: '+c.name+' fails even with a blanket SUPPORTED verdict',()=>{
 const p=[{id:'title',text:c.candidate}],l=fidelityLedgerSchema.parse(supportedLedger(c.source,p));
 Object.assign(l.sourceCoverage[0].temporal[0],{sourceState:c.a,candidateState:c.b,assessment:'PRESERVED'});
 assert.throws(()=>validateFidelityLedger(c.source,p,l),e=>{assert(e instanceof Error);assert.match(JSON.stringify(e),/TEMPORAL_SCOPE_CHANGE|INCONSISTENT_TEMPORAL_ASSESSMENT/);return true;});
});
test('conceptual rewrite and journalistic present retain the same event time meaning',()=>{
 const source='أنجز المجلس المشروع أمس.';const p=[{id:'title',text:'المجلس يتم مشروعه الذي أُنجز أمس'}];
 const l=fidelityLedgerSchema.parse(supportedLedger(source,p));
 l.sourceCoverage[0].temporal[0].sourceState=state({time:'PAST',phase:'COMPLETED'});l.sourceCoverage[0].temporal[0].candidateState=state({time:'PAST',phase:'COMPLETED'});
 assert.doesNotThrow(()=>validateFidelityLedger(source,p,l));
});
test('no temporal result / uncertain result / unreviewed candidate words cannot pass',()=>{
 const source='ناقشت اللجنة المشروع.';const p=[{id:'title',text:source+' وما زالت تناقشه.'}],l=fidelityLedgerSchema.parse(supportedLedger(source,p));
 l.sourceCoverage[0].temporal=[];assert.throws(()=>validateFidelityLedger(source,p,l));
 l.sourceCoverage[0].temporal=supportedLedger(source,p).sourceCoverage[0].temporal;
 l.sourceCoverage[0].temporal[0].assessment='UNCERTAIN';assert.throws(()=>validateFidelityLedger(source,p,l));
 const f=fixture('u',source);assert.deepEqual(fidelityRepairDiagnostics(l,source,f.understanding,{}),[]);
 l.sourceCoverage[0].temporal[0].assessment='PRESERVED';l.claims[0].excerpt=source;
 assert.throws(()=>validateFidelityLedger(source,p,l),/FIDELITY|REVIEW_RECEIPT_INVALID/);
});
test('temporal annotations must refer to actual persisted source and actual candidate',()=>{
 const source='افتتح المجلس المدرسة.';const p=[{id:'title',text:source}],l=fidelityLedgerSchema.parse(supportedLedger(source,p));
 l.sourceCoverage[0].temporal[0].sourceExcerpt='سيبني المجلس مدرسة.';assert.throws(()=>validateFidelityLedger(source,p,l));
 l.sourceCoverage[0].temporal[0].sourceExcerpt=source;l.sourceCoverage[0].temporal[0].candidateExcerpt='نص غير موجود';assert.throws(()=>validateFidelityLedger(source,p,l));
});
test('recorded case261 old blanket approval is insufficient and faithful contrast rejects drift',()=>{
 assert.throws(()=>validateFidelityLedger(oldFalseAccept.source,oldFalseAccept.publication,oldFalseAccept.ledger));
 const l=fidelityLedgerSchema.parse(supportedLedger(oldFalseAccept.source,oldFalseAccept.publication));
 const comparison=l.sourceCoverage.flatMap(r=>r.temporal).find(t=>t.publicationId==='body:1')!;
 Object.assign(comparison,{sourceState:state({time:'PAST',phase:'OCCURRING'}),candidateState:state({time:'PRESENT',phase:'OCCURRING',continuity:'CONTINUING'}),assessment:'CHANGED'});
 assert.throws(()=>validateFidelityLedger(oldFalseAccept.source,oldFalseAccept.publication,l));
});
test('case305 canonical display prefixes are accounting-only; factual wording still fully checked',()=>{
 const r=replay.find(r=>r.index===305)!;
 const combined=r.outputs.filter(o=>'article' in o).at(-1) as {article:{title:string;body:string}};
 const p=[{id:'title',text:combined.article.title},{id:'body:1',text:combined.article.body}];
 const l=fidelityLedgerSchema.parse(supportedLedger(r.sourceText,p));
 for(const c of l.claims){const n=canonicalPresentationPrefixLength(r.sourceText,c.excerpt);c.excerpt=c.excerpt.slice(n);c.components[0].excerpt=c.excerpt;for(const row of l.sourceCoverage)for(const t of row.temporal)if(t.publicationId===c.publicationId)t.candidateExcerpt=c.excerpt;}
 assert.doesNotThrow(()=>validateFidelityLedger(r.sourceText,p,l));
 assert.throws(()=>validateFidelityLedger(r.sourceText,[p[0],{...p[1],text:p[1].text+' وأعلن إنشاء جامعة.'}],l));
 assert.equal(canonicalPresentationPrefixLength('افتتح المجلس مدرسة.','فيديو | افتتح المجلس مدرسة.'),0);
 assert.equal(canonicalPresentationPrefixLength(r.sourceText,'إيران الآن | أعلنت الوزارة | حقيقة'), 'إيران الآن | '.length);
 assert.equal(canonicalPresentationPrefixLength(r.sourceText,'خبرنا | حقيقة'),0);
});
for(const index of [402,413])test('IRNA '+index+' invalid position plus multiply occurring contextual excerpt stays blocked',()=>{
 const r=replay.find(r=>r.index===index)!;
 for(const raw of r.outputs.filter(o=>'location' in o)){
  const loc=structuredClone((raw as {location:{excerpt:string;context:string;startOffset:number;endOffset:number}}).location);
  assert.notEqual(r.sourceText.slice(loc.startOffset,loc.endOffset),loc.excerpt);
  assert.throws(()=>resolveContextEvidence(loc,r.sourceText),/AMBIGUOUS_EVIDENCE_CONTEXT/);
 }
});
test('review policy is general semantic state comparison, not a source-specific phrase rule',()=>{
 assert(!temporalReviewInstructions.includes('44213'));assert(!temporalReviewInstructions.includes('كانت تتم'));
 assert(temporalReviewInstructions.includes('NOT grammatical tense'));
 const canonical=readFileSync('config/editorial/iran-now-contract.txt','utf8');assert(canonical.includes('22. VIDEO POSTS'));
});

test('every preserved source context requires its own temporal comparison',()=>{
 const source='أعلنت اللجنة افتتاح المدرسة.\nكانت أعمال البناء تجري العام الماضي.';
 const publication=[{id:'title',text:'أعلنت اللجنة افتتاح المدرسة بعد أعمال البناء العام الماضي.'}];
 const ledger=supportedLedger(source,publication);
 assert(ledger.sourceCoverage.length>1);
 ledger.sourceCoverage.at(-1)!.temporal=[];
 assert.throws(()=>validateFidelityLedger(source,publication,ledger),/FIDELITY|REVIEW_RECEIPT_INVALID/);
});

test('actual targeted review rejects case261 on semantic time-state mismatch, not schema incompleteness',()=>{
 assert.throws(()=>validateFidelityLedger(actualTemporalReview.source,actualTemporalReview.publication,componentFixture(actualTemporalReview.review.fidelityLedger)),e=>{
  assert(e instanceof Error);assert.match(JSON.stringify(e),/TEMPORAL_SCOPE_CHANGE|INCONSISTENT_TEMPORAL_ASSESSMENT/);return true;
 });
 const row=actualTemporalReview.review.fidelityLedger.sourceCoverage.find(r=>r.unitId===actualTemporalReview.expected.unitId)!;
 assert(row.temporal.some(t=>t.sourceState.time==='PAST'&&t.candidateState.time==='PRESENT'));
});

test('temporal comparison need not repeat non-temporal reporting connectors already covered by claim review',()=>{
 const source='أعلنت اللجنة أن العمل اكتمل أمس.';const publication=[{id:'title',text:'اللجنة تعلن إتمام العمل أمس'}];
 const ledger=supportedLedger(source,publication);
 Object.assign(ledger.sourceCoverage[0].temporal[0],{sourceExcerpt:'العمل اكتمل أمس',candidateExcerpt:'إتمام العمل أمس',sourceState:state({time:'PAST',phase:'COMPLETED'}),candidateState:state({time:'PAST',phase:'COMPLETED'})});
 assert.doesNotThrow(()=>validateFidelityLedger(source,publication,ledger));
});

test('actual faithful control with invented ellipses in review evidence fails closed',()=>{
 assert.throws(()=>validateFidelityLedger(faithfulControl.source,faithfulControl.publication,componentFixture(faithfulControl.review.fidelityLedger)),e=>{
  assert(e instanceof Error);assert.match(JSON.stringify(e),/INVALID_TEMPORAL_SOURCE/);return true;
 });
});

test('actual case305 claim excerpts cover all factual words after canonical display accounting',()=>{
 for(const p of displayAccounting.publication){
  const mask=new Uint8Array(p.text.length);mask.fill(1,0,canonicalPresentationPrefixLength(displayAccounting.source,p.text));
  for(const c of displayAccounting.claims.filter(c=>c.publicationId===p.id)){
   const span={excerpt:c.excerpt,context:p.text,start:0,end:0};resolveContextEvidence(span,p.text);mask.fill(1,span.start,span.end);
  }
  for(let i=0;i<p.text.length;i++)if(/[\p{L}\p{N}]/u.test(p.text[i]))assert(mask[i]);
 }
});

for(const stage of ['direct_independent_review','direct_publication_review'])test(stage+' wire contract puts source analysis before aggregate verdicts',async()=>{
 let requests=0;
 let order:string[]=[],ledgerOrder:string[]=[];
 const provider=new GeminiLanguageProvider('offline-test-key',async(_url,init)=>{
  requests++;
  const request=JSON.parse(String(init?.body));
  const properties=request.generationConfig.responseJsonSchema.properties;
  order=Object.keys(properties);ledgerOrder=Object.keys(properties.fidelityLedger.properties);
  return new Response(JSON.stringify({error:{code:503,status:'UNAVAILABLE',message:'Offline mock'}}),{status:503});
 });
 const delegate=(provider as unknown as {delegate:{request:(...args:unknown[])=>Promise<unknown>}}).delegate;
 await assert.rejects(()=>delegate.request('understand',{originalSource:'افتتحت مدرسة.',publication:[{id:'title',text:'افتتاح مدرسة'}],comparisons:[]},ruleSet,AbortSignal.timeout(1000),stage,[],true));
 assert.equal(requests,1);
 assert.equal(order[0],'fidelityLedger');assert.equal(ledgerOrder[0],'sourceCoverage');
});
