import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanCases,newsroom} from './fixtures/newsroom';
import {official} from './fixtures/processing';
import {finalizeSelection,finalizeConstrainedDraft} from '../src/lib/processing/local-finalization';
import {buildAtoms,renderSelection} from '../src/lib/processing/constrained-rewrite';
import {editorialDecision,reviewMessages,readEditorialState,arabicReasons} from '../src/lib/processing/editorial-eligibility';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
import {monthLabelConvention,validateMonthRendering} from '../src/lib/processing/newsroom-format';
import {publicationText} from '../src/lib/telegram/publisher';
const held={autoPublish:false,shadowMode:true,requireApproval:true};
export function replay(source:string,u:ReturnType<typeof newsroom>){
 const ids=u.event.facts.map(f=>f.id);
 const result=finalizeSelection({titleAtomId:ids[0],bodyAtomIds:ids},source,u,official);
 return {result,...editorialDecision({validated:true,review:result.review},held)};
}
for(const c of cleanCases())test(`SHOULD_PASS: ${c.name}`,()=>{
 const r=replay(c.source,c.u);
 assert.equal(r.editorialEligibility,'READY_TO_PUBLISH',JSON.stringify(r.result.review));assert.equal(r.deliveryDecision,'HOLD');
 assert.ok(r.result.title.startsWith('إيران الآن | '));assert.deepEqual(r.result.hashtags,[]);
 assert.ok(!r.result.body.includes(r.result.title.replace('إيران الآن | ','')));
 assert.ok(r.result.sentenceEvidence.some(s=>s.text===r.result.title));
 assert.equal(publicationText({title:r.result.title,arabicContent:r.result.body}),[r.result.title,r.result.body].filter(Boolean).join('\n\n'));
 const atoms=buildAtoms(c.source,c.u),selection={titleAtomId:atoms.atoms[0].id,bodyAtomIds:atoms.atoms.map(a=>a.id)};
 assert.deepEqual(finalizeConstrainedDraft(renderSelection(selection,atoms),c.source,c.u,official),r.result);
});
const unsafeChanges:Record<string,(u:ReturnType<typeof newsroom>)=>void>={
 'unsupported addition':u=>{u.event.facts[0].arabic+=' وحقق انتصارا';},
 'altered number':u=>{u.event.facts[0].arabic=u.event.facts[0].arabic.replace('25','26');},
 'invented number':u=>{u.event.facts[0].arabic+=' بعد 30 ساعة';},
 'ambiguous identity':u=>{u.names.push({arabic:'شخص مجهول',kind:'person',evidence:u.event.facts[0].evidence});},
 'lost attribution':u=>{u.seriousClaim=true;u.event.facts[0].kind='CLAIM';},
 'unsupported rank':u=>{u.event.actors[0].arabic='قائد الجيش';u.rankUnverified=true;},
 'corrupted quote':u=>{u.event.facts[0].arabic='«خبر مختلق»';},
 'invented date/location/outcome':u=>{u.event.facts[0].arabic+=' في باريس يوم 2026-01-01 وأسفر عن إصابات';},
 'incomplete extraction':u=>{u.event.facts=[];},
};
for(const [name,change] of Object.entries(unsafeChanges))test(`SHOULD_REMAIN_REVIEW: ${name}`,()=>{
 const source='أعلنت الوزارة في بيان أن المجلس وافق على 25 مقترحا.';
 const u=newsroom(source,[source]);change(u);
 try{assert.equal(replay(source,u).editorialEligibility,'NEEDS_REVIEW');}catch(e){assert.ok(e instanceof Error&&/NO_REWRITE_FACTS|SPEAKER_ATTRIBUTION_REQUIRED/.test(e.message));}
});
test('unresolved speaker, certainty upgrade and conflicting context fail closed',()=>{
 const c=cleanCases().find(c=>c.name==='Attributed serious claim')!;
 c.u.event.facts[0].speaker!.evidence={excerpt:'قال',start:0,end:3};
 assert.equal(replay(c.source,c.u).editorialEligibility,'NEEDS_REVIEW');
 const uncertain=cleanCases().find(c=>c.name==='Preserved uncertainty')!;
 uncertain.u.event.facts[0].arabic='اجتمع الوفد في العاصمة.';
 assert.equal(replay(uncertain.source,uncertain.u).editorialEligibility,'NEEDS_REVIEW');
 assert.throws(()=>resolveContextEvidence({excerpt:'خبر',context:'خبر خبر'},'خبر خبر'),/AMBIGUOUS_EVIDENCE_CONTEXT/);
});
test('eligibility/delivery matrix, historical failures and Arabic explanations',()=>{
 for(const delivery of [held,{...held,shadowMode:false},{...held,autoPublish:true}])assert.deepEqual(editorialDecision({validated:true},delivery),{editorialEligibility:'READY_TO_PUBLISH',deliveryDecision:'HOLD',review:[]});
 assert.equal(editorialDecision({validated:true,review:[{code:'SHADOW_MODE_REVIEW'}]},held).editorialEligibility,'READY_TO_PUBLISH');
 assert.equal(editorialDecision({validated:true,humanOverride:true},held).deliveryDecision,'HOLD');
 for(const code of ['GROQ_REQUEST_LIMIT','PROVIDER_REQUEST_LIMIT','GEMINI_HTTP_503','INVALID_DRAFT_SCHEMA','PROCESSING_FAILED'])assert.equal(editorialDecision({error:code},held).editorialEligibility,'PROCESSING_ERROR');
 assert.equal(editorialDecision({filtered:true},held).editorialEligibility,'FILTERED');
 assert.equal(readEditorialState({review:[{code:'SHADOW_MODE_REVIEW'}]},'NEEDS_REVIEW'),'NEEDS_REVIEW');
 for(const code of ['SPEAKER_ATTRIBUTION_MISMATCH','AMBIGUOUS_EVIDENCE_CONTEXT','SOURCE_LANGUAGE_UNCERTAIN','VALIDATED_ARABIC_RENDERING_REQUIRED','UNSUPPORTED_OUTPUT'])assert.ok(arabicReasons[code]);
 assert.equal(reviewMessages([{code:'UNKNOWN_FUTURE_REASON'}])[0],'يتطلب الخبر مراجعة تحريرية إضافية');
 assert.equal(reviewMessages([{code:'NUMBER_MISMATCH'},{code:'ARABIC_RENDERING_NUMBER_MISMATCH'}]).length,1);
});
test('month label convention never pretends to convert a concrete calendar date',()=>{
 assert.match(monthLabelConvention('راتب شهریور'),/أيلول/);
 assert.equal(monthLabelConvention('27 شهریور 1405'),'27 شهریور 1405');
 assert.throws(()=>validateMonthRendering('27 شهریور 1405','27 أيلول 1405'),/MATERIAL_DATE_MISMATCH/);
 assert.doesNotThrow(()=>validateMonthRendering('27 شهریور 1405','27 أيلول 1405 بالتقويم الإيراني'));
 assert.throws(()=>validateMonthRendering('شهریور','آب'),/MATERIAL_DATE_MISMATCH/);
});
test('newsroom punctuation cannot corrupt a grounded numeric separator',()=>{
 const source='أعلنت الوزارة في بيان أن المجلس وافق على 1,000 مقترح.';
 const r=replay(source,newsroom(source,[source]));
 assert.equal(r.editorialEligibility,'READY_TO_PUBLISH');
 assert.ok(r.result.title.includes('1,000'));assert.ok(!r.result.title.includes('1،000'));
});
