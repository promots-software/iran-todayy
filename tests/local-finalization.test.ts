import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeSelection,finalizeConstrainedDraft} from '../src/lib/processing/local-finalization';
import {buildAtoms,renderSelection} from '../src/lib/processing/constrained-rewrite';
import {editDraft} from '../src/lib/processing/editorial';
import {fixture,official} from './fixtures/processing';
const setup=()=>{const f=fixture('local','قال متحدث إن فريقنا لم يبلغ.','ar','فريقنا لم يبلغ.');f.understanding.seriousClaim=true;f.understanding.event.facts[0].kind='CLAIM';f.understanding.event.facts[0].speaker={key:'speaker',arabic:'متحدث',evidence:{excerpt:'متحدث',start:4,end:9}};return f;};
test('local attestations separate proven invariants from explicit human review',()=>{
 const f=setup(),id=f.understanding.event.facts[0].id;
 const r=finalizeSelection({titleAtomId:id,bodyAtomIds:[id]},f.content,f.understanding,{...official,verified:false});
 assert.equal(r.attestations.factsPreserved,true);assert.equal(r.attestations.attributionChecked,true);assert.equal(r.attestations.numbersChecked,true);
 for(const key of ['titlesChecked','spellingChecked','noUncoveredTerms'] as const){assert.equal(r.attestations[key],false);assert.ok(r.review.some(x=>x.code==='EDITORIAL_ATTESTATION_REQUIRED'&&x.detail===`ATTESTATION_NOT_ESTABLISHED: ${key}`));assert.ok(r.attestationReasons[key]);}
 assert.ok(!r.review.some(x=>x.code==='UNSUPPORTED_OUTPUT'));
 assert.ok(r.review.some(x=>x.code==='UNVERIFIED_SOURCE'));assert.ok(r.review.some(x=>x.code==='SERIOUS_CLAIM'));
 assert.ok(r.sentenceEvidence.some(s=>s.text===r.title));assert.ok(r.sentenceEvidence.some(s=>s.text===r.body));
});
test('factual attestation failures remain unsupported and exact term/name flags stay visible',()=>{
 const f=setup(),atoms=buildAtoms(f.content,f.understanding),id=atoms.atoms[0].id;
 f.understanding.uncoveredTerms=['مصطلح اختبار غير مغطى'];
 f.understanding.names=[{arabic:'اسم اختبار غير موثق',kind:'institution',evidence:f.understanding.event.facts[0].evidence}];
 for(const key of ['factsPreserved','attributionChecked','numbersChecked'] as const){
  const d=renderSelection({titleAtomId:id,bodyAtomIds:[id]},atoms);d.attestation[key]=false;
  const r=editDraft(d,f.content,f.understanding,official);
  assert.ok(r.review.some(x=>x.code==='UNSUPPORTED_OUTPUT'&&x.detail===`ATTESTATION_NOT_ESTABLISHED: ${key}`));
  assert.ok(r.review.some(x=>x.code==='UNCOVERED_TERM'&&x.detail==='مصطلح اختبار غير مغطى'));
  assert.ok(r.review.some(x=>x.code==='UNKNOWN_NAME'&&x.detail==='اسم اختبار غير موثق'));
 }
});
test('only terminal punctuation is normalized before recording title provenance',()=>{
 const f=setup(),atoms=buildAtoms(f.content,f.understanding),id=atoms.atoms[0].id;
 const d=renderSelection({titleAtomId:id,bodyAtomIds:[id]},atoms);
 assert.equal(d.title,d.body.slice(0,-1));assert.equal(d.sentences[0].text,d.title);
 d.title+=' معلومة أخرى';assert.throws(()=>editDraft(d,f.content,f.understanding,official),/MISSING_TITLE_PROVENANCE/);
});
test('final rule-engine spelling changes also update provenance exactly',()=>{
 const f=fixture('spell','اعلان جديد.','ar','اعلان جديد.');const id=f.understanding.event.facts[0].id;
 const r=finalizeSelection({titleAtomId:id,bodyAtomIds:[id]},f.content,f.understanding,official);
 assert.equal(r.title,'إعلان جديد');assert.ok(r.sentenceEvidence.some(s=>s.text===r.title));assert.ok(r.sentenceEvidence.some(s=>s.text===r.body));
});
test('worker finalization reconstructs atom output and refuses changed text or forged metadata',()=>{
 const f=setup(),atoms=buildAtoms(f.content,f.understanding),id=atoms.atoms[0].id;
 const d=renderSelection({titleAtomId:id,bodyAtomIds:[id]},atoms);
 const result=finalizeConstrainedDraft(d,f.content,f.understanding,official);
 assert.ok(!result.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'));
 assert.throws(()=>finalizeConstrainedDraft({...d,body:d.body+' إضافة'},f.content,f.understanding,official),/CONSTRAINED_TEXT_CHANGED/);
 assert.throws(()=>finalizeConstrainedDraft({...d,decisions:[{ruleId:'invented',from:'x',to:'y',context:'x',evidence:f.understanding.event.facts[0].evidence}]},f.content,f.understanding,official),/CONSTRAINED_DRAFT_CHANGED/);
});
