import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDataset,type GoldCase} from './benchmarks/direct-gold/schema';
import {replayTransport,replayExtraction} from './benchmarks/direct-gold/replay';
import {AssumedPropositionGemini as GeminiLanguageProvider} from './fixtures/proposition-mock';
import {validateUnderstanding,type Understanding} from '../src/lib/processing/contracts';
import {adaptDirectExtraction,validateDirectExtraction} from '../src/lib/processing/direct';
import {prepareDirectBilingual,finalizeDirectBilingual} from '../src/lib/processing/direct-bilingual';
import {passingReview} from './fixtures/direct-bilingual';
import {buildAtoms,renderSelection} from '../src/lib/processing/constrained-rewrite';
import {attributionLead} from '../src/lib/processing/attribution-rendering';
import {matchEvent,type Candidate} from '../src/lib/processing/matcher';
const data=validateDataset(JSON.parse(readFileSync('tests/benchmarks/direct-gold-v1.json','utf8')));
const get=(id:string)=>structuredClone(data.cases.find(c=>c.id===id)!);
const signal=new AbortController().signal,now=new Date('2026-01-01T00:00:00Z');
async function understand(c:GoldCase){
 // Retained legacy receipt/matching utilities, not the current provider flow.
 // The current two-request canonical path is tested in direct-generation.test.
 const provider=new GeminiLanguageProvider('offline',replayTransport(c));
 const raw=replayExtraction(c);
 let adapted;
 if(c.language==='ar'){
  const extraction={...raw};delete (extraction as {publication?:unknown}).publication;delete (extraction as {coverage?:unknown}).coverage;
  adapted=adaptDirectExtraction(validateDirectExtraction(extraction,c.sourceText),c.sourceText);
 }else{
  const p=prepareDirectBilingual(raw,c.sourceText);
  adapted=adaptDirectExtraction(p.grounded,c.sourceText,finalizeDirectBilingual(c.sourceText,p,passingReview(c.sourceText,p)));
 }
 const u=validateUnderstanding(adapted,c.sourceText);
 return {u,provider};
}
test('institutional grammar uses feminine head without inventing a medium',()=>{
 for(const s of ['وزارة النقل','هيئة النقل','البلدية','وكالة الأنباء','اللجنة'])assert.equal(attributionLead(s),`قالت ${s}:`);
 assert.equal(attributionLead('المجلس'),'قال المجلس:');
});
for(const id of ['D37','D39','D40'])test('retained Persian receipt preserves one attribution '+id,async()=>{
 const c=get(id),{u}=await understand(c);assert(u.rendering?.fullSourceCoverage);
 const d=renderSelection({titleAtomId:'f1',bodyAtomIds:['f1']},buildAtoms(c.sourceText,u));
 assert.equal(d.title,'إيران الآن | '+c.replay.arabicFacts[0].replace(/\.$/u,''));assert(!/إفادته|تصريحه|بيانه|قال وزارة/u.test(d.title));
 const speaker=c.requiredAttributions[0];assert.equal(d.title.split(speaker).length-1,1);
});
test('multi-sentence Persian keeps every reviewed attribution without duplicate heading',async()=>{
 const c=get('D37'),source='وزارت راه اعلام کرد نتایج بعداً منتشر می‌شود.',arabic='أعلنت وزارة النقل أن النتائج ستنشر لاحقاً.';
 c.sourceText+='\n'+source;c.materialFacts.push({id:'f2',sourceExcerpt:source,meaning:arabic,predicates:[{anyOf:['ستنشر']}]});c.replay.arabicFacts.push(arabic);c.expectedCoverage.push('f2');
 const {u}=await understand(c);
 const atoms=buildAtoms(c.sourceText,u),d=renderSelection({titleAtomId:'f1',bodyAtomIds:['f1','f2']},atoms);
 assert.equal(d.format,'STANDARD_STORY');assert.equal(d.body,arabic);assert(!/إفادته|تصريحه|بيانه/u.test(d.title+d.body));assert.equal(d.sentences.length,2);
 const broken=structuredClone(u);delete broken.rendering;assert.throws(()=>buildAtoms(c.sourceText,broken));
});
const candidate=(u:Understanding):Candidate=>({id:'prior',revisionId:'prior:1',revision:1,publishedAt:now,data:u.event,published:false});
test('exact duplicate and non-material repetition stay duplicate',async()=>{
 const c=get('D01'),{u,provider}=await understand(c),prior=candidate(u);
 assert.equal((await matchEvent(u.event,now,[prior],provider,signal,{source:c.sourceText,understanding:u})).classification,'DUPLICATE');
 const repeated=structuredClone(u);repeated.event.facts[0].material=false;
 assert.equal((await matchEvent(repeated.event,now,[prior],provider,signal,{source:c.sourceText,understanding:repeated})).classification,'DUPLICATE');
});
test('source-grounded update is recognized while all independent-truth flags remain false',async()=>{
 const old=await understand(get('D01')),c=get('D44'),{u,provider}=await understand(c);
 assert(u.event.facts.every(f=>!f.verified));const m=await matchEvent(u.event,now,[candidate(old.u)],provider,signal,{source:c.sourceText,understanding:u});
 assert.equal(m.classification,'MATERIAL_UPDATE');assert.deepEqual(m.newFactIds,['f2']);assert.equal(m.evidence.sourceGrounded,true);assert(u.event.facts.every(f=>!f.verified));
});
test('uncertain relation, unsupported evidence and fabricated verified=true all fail closed',async()=>{
 const old=await understand(get('D01')),c=get('D44'),{u,provider}=await understand(c),prior=candidate(old.u);
 const uncertain={...provider,id:provider.id,live:true,understand:provider.understand.bind(provider),draft:provider.draft.bind(provider),compare:async()=>({relation:'UNCERTAIN',newFactIds:['f2'],conflictingFactIds:[],rationale:'لم يثبت التطابق'})};
 assert.equal((await matchEvent(u.event,now,[prior],uncertain,signal,{source:c.sourceText,understanding:u})).classification,'UNCERTAIN_MATCH');
 for(const mutate of [(x:Understanding)=>{x.event.facts[1].arabic+=' بمشاركة جهة أخرى';},(x:Understanding)=>{x.event.facts[1].evidence.start=0;},(x:Understanding)=>{x.event.facts[1].speaker!.arabic='جهة أخرى';}]){
  const bad=structuredClone(u);mutate(bad);bad.event.facts[1].verified=true;
  assert.equal((await matchEvent(bad.event,now,[prior],provider,signal,{source:c.sourceText,understanding:bad})).classification,'UNCERTAIN_MATCH');
 }
 const asserted=structuredClone(u);asserted.event.facts[1].verified=true;assert.equal((await matchEvent(asserted.event,now,[prior],provider,signal)).classification,'UNCERTAIN_MATCH');
});
