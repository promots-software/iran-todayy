import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptDirectExtraction} from '../src/lib/processing/direct';
import {bilingualInstructions,prepareDirectBilingual,finalizeDirectBilingual} from '../src/lib/processing/direct-bilingual';
import {bilingualFixture,passingReview} from './fixtures/direct-bilingual';
test('combined instructions permit attached Arabic without asking for generated IDs or a second output format',()=>{assert.ok(!bilingualInstructions.includes('Do not generate summary, translations'));assert.ok(!bilingualInstructions.includes('Return only id and arabic'));assert.ok(bilingualInstructions.includes('IDs are assigned locally'));});
// Current DIRECT fa/en provider path, checkpoint replay and delivery integration
// are exercised in direct-generation.test.ts. These tests cover retained receipts.
test('Call 1 alone is not a trusted receipt and cannot supply an approved translation',()=>{
 const f=bilingualFixture(),p=prepareDirectBilingual(f.raw,f.source);assert.ok(!('review' in p.rendered));assert.throws(()=>adaptDirectExtraction(p.grounded,f.source),/VALIDATED_ARABIC_RENDERING_REQUIRED/);assert.throws(()=>finalizeDirectBilingual(f.source,p,{}),/INVALID_DIRECT_REVIEW_SCHEMA/);
});
test('retained bilingual proposal blocks numeric/calendar/quote corruption locally',()=>{
 const f=bilingualFixture();
 for(const text of ['افتتح المجلس 13 مدرسة جديدة في العاصمة.','«افتتح المجلس 12 مدرسة جديدة في العاصمة»']){const raw=structuredClone(f.raw);raw.statements[0].evidence.arabic=text;assert.throws(()=>prepareDirectBilingual(raw,f.source));}
 const source=f.source+' در ۱۲ مهر',x=structuredClone(f.raw);for(const v of [...x.actors,x.action,x.object,x.location,x.statements[0].evidence])v.context=source;x.statements[0].evidence.excerpt=source;x.statements[0].evidence.arabic+=' في 12 حزيران';assert.throws(()=>prepareDirectBilingual(x,source),/MATERIAL_DATE_MISMATCH/);
 const added=structuredClone(f.raw);added.statements[0].evidence.arabic='افتتحت الحكومة الأميركية 12 مدرسة جديدة في العاصمة.';const p=prepareDirectBilingual(added,f.source),review=passingReview(f.source,p);review.review.find(r=>r.id==='f1')!.checks.entitiesAndRelationships=false;assert.throws(()=>finalizeDirectBilingual(f.source,p,review),/UNVALIDATED_ARABIC_RENDERING/);
});
test('independent semantic rejection blocks unsupported wording, relationships, dates and missing attribution',()=>{
 const f=bilingualFixture(),p=prepareDirectBilingual(f.raw,f.source);
 for(const key of ['scope','entitiesAndRelationships','namesAndTitles','numbers','attribution','negationAndModality','literalQuotes']){
 const review=passingReview(f.source,p);review.review[0].checks[key]=false;review.review[0].verdict='UNSUPPORTED';review.review[0].issues=['Unsupported semantic addition or omission'];assert.throws(()=>finalizeDirectBilingual(f.source,p,review),/UNVALIDATED_ARABIC_RENDERING/);
 }
 const added=structuredClone(f.raw);added.statements[0].evidence.arabic+=' بأمر من الحكومة';const q=prepareDirectBilingual(added,f.source),review=passingReview(f.source,q);review.review.find(r=>r.id==='f1')!.verdict='UNSUPPORTED';assert.throws(()=>finalizeDirectBilingual(f.source,q,review),/UNVALIDATED_ARABIC_RENDERING/);
});
test('speaker evidence is immutable and missing explicit attribution requires independent rejection',()=>{
 const source='سخنگو گفت: شورا ۱۲ مدرسه جدید را در پایتخت افتتاح کرد.';const x=bilingualFixture().raw;for(const v of [...x.actors,x.action,x.object,x.location,x.statements[0].evidence])v.context=source;
 const speaker={excerpt:'سخنگو',context:source,arabic:'المتحدث'};
 const withSpeaker={...x,statements:[{...x.statements[0],kind:'STATEMENT',speaker}]};const p=prepareDirectBilingual(withSpeaker,source);assert.equal(p.refs.find(r=>r.role==='speaker')!.evidence.excerpt,'سخنگو');
 const wrong={...withSpeaker,statements:[{...withSpeaker.statements[0],speaker:{...speaker,excerpt:'مخترع'}}]};assert.throws(()=>prepareDirectBilingual(wrong,source),/INVALID_EVIDENCE/);
 const omitted=prepareDirectBilingual(x,source),review=passingReview(source,omitted);review.coverage.complete=false;review.coverage.units[0].verdict='MISSING';review.coverage.units[0].reason='Explicit speaker omitted';assert.throws(()=>finalizeDirectBilingual(source,omitted,review),/MATERIAL_COVERAGE/);
});
test('full-source coverage cannot omit source units, invent IDs or claim completion with missing/uncertain material',()=>{
 const f=bilingualFixture(),source=f.source+'\nبودجه این طرح ۵ میلیون است.',p=prepareDirectBilingual(f.raw,source);
 const base=passingReview(source,p);
 for(const verdict of ['MISSING','UNCERTAIN']){const review=structuredClone(base);review.coverage.units[1].verdict=verdict;assert.throws(()=>finalizeDirectBilingual(source,p,review),/MATERIAL_COVERAGE/);}
 const dropped=structuredClone(base);dropped.coverage.units.pop();assert.throws(()=>finalizeDirectBilingual(source,p,dropped),/INVALID_DIRECT_REVIEW_SCHEMA/);
 const falseCovered=structuredClone(base);falseCovered.coverage.units[1].factIds=['f1'];assert.throws(()=>finalizeDirectBilingual(source,p,falseCovered),/COVERAGE_FACT_MISMATCH/);
 const denial=structuredClone(base);denial.coverage.units[0]={...denial.coverage.units[0],verdict:'NON_FACTUAL',factIds:[]};assert.throws(()=>finalizeDirectBilingual(source,p,denial),/COVERAGE_FACT_MISMATCH/);
 const incomplete=structuredClone(base);incomplete.coverage.complete=false;assert.throws(()=>finalizeDirectBilingual(source,p,incomplete),/MATERIAL_COVERAGE/);
});
test('source lines, speaker headings and non-factual footer retain exact full-source coverage',()=>{
 const source='سخنگو:\n🔹 شورا ۱۲ مدرسه جدید را در پایتخت افتتاح کرد.\n@channel',x=bilingualFixture().raw;
 for(const e of [...x.actors,x.action,x.object,x.location,x.statements[0].evidence])e.context=source;
 const raw={...x,statements:[{...x.statements[0],kind:'STATEMENT',speaker:{excerpt:'سخنگو',context:source,arabic:'المتحدث'}}]};
 const p=prepareDirectBilingual(raw,source),review=passingReview(source,p);review.coverage.units[2]={id:'u3',verdict:'NON_FACTUAL',factIds:[],reason:'Channel handle only'};
 const receipt=finalizeDirectBilingual(source,p,review);assert.equal(receipt.fullSourceCoverage!.units.length,3);assert.deepEqual(receipt.fullSourceCoverage!.units[0].factIds,['f1']);
});
