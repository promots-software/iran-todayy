import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAtoms,renderSelection,atomSelectionSchema} from '../src/lib/processing/constrained-rewrite';
import {fixture,official} from './fixtures/processing';
import {editDraft} from '../src/lib/processing/editorial';
import {GroqLanguageProvider} from '../src/lib/processing/groq';
import {ruleSet} from '../src/lib/processing/rules';
const setup=()=>{
 const f=fixture('atom','قال متحدث: منشآتنا تضررت ولم يبلغ أعضاء الفريق.','ar','منشآتنا تضررت ولم يبلغ أعضاء الفريق.');
 f.understanding.seriousClaim=true;
 f.understanding.event.facts[0].kind='CLAIM';
 f.understanding.event.facts[0].speaker={key:'SPEAKER',arabic:'متحدث',evidence:{excerpt:'متحدث',start:4,end:9}};
 const input=buildAtoms(f.content,f.understanding);
 return {f,input,selection:{titleAtomId:input.atoms[0].id,bodyAtomIds:[input.atoms[0].id]}};
};
test('unresolved possessive and audience-specific knowledge remain byte-identical',()=>{
 const {input,selection}=setup();const d=renderSelection(selection,input);
 assert.equal(d.title,'إيران الآن | '+input.atoms[0].renderedText.replace(/\.$/u,''));
 assert.equal(d.body,'');
 assert.ok(d.title.includes('منشآتنا'));
 assert.ok(d.title.includes('لم يبلغ أعضاء الفريق'));
 assert.ok(!d.title.includes('لم يعلن'));
});
test('serious claim title attribution is locally rendered and passes existing attribution check',()=>{
 const {f,input,selection}=setup();const d=renderSelection(selection,input);
 assert.ok(d.title.startsWith('إيران الآن | قال متحدث'));
 const result=editDraft(d,f.content,f.understanding,official);
 assert.ok(!result.review.some(r=>r.detail==='النسب الصريح مطلوب في العنوان والمتن'));
 assert.ok(result.review.some(r=>r.code==='SERIOUS_CLAIM'));
});
test('nationality and ownership cannot enter through model output',()=>{
 const {input,selection}=setup();
 for(const text of ['متحدث فرنسي','منشآت بلاده'])assert.throws(()=>renderSelection({...selection,title:text},input),/INVALID_ATOM_SELECTION/);
});
test('valid IDs do not license semantic overreach or arbitrary body text',()=>{
 const {input,selection}=setup();
 assert.throws(()=>renderSelection({...selection,body:'لم يكشف أحد أي معلومات',factIds:selection.bodyAtomIds},input),/INVALID_ATOM_SELECTION/);
 assert.equal(atomSelectionSchema(input).safeParse({...selection,titleAtomId:'unknown'}).success,false);
 const d=renderSelection(selection,input);
 assert.deepEqual(d.sentences.map(s=>s.factIds),[selection.bodyAtomIds]);
 assert.deepEqual(d.protectedSpans,[]);
 assert.deepEqual(d.decisions,[]);
});
test('shared transport receives atoms only and returns locally rendered draft offline',async()=>{
 const {f,input,selection}=setup();let calls=0;
 const provider=new GroqLanguageProvider('offline',async(_url,init)=>{
  calls++;const request=JSON.parse(String(init?.body));
  assert.deepEqual(JSON.parse(request.messages[1].content),input);
  assert.deepEqual(Object.keys(request.response_format.json_schema.schema.properties),['titleAtomId','bodyAtomIds']);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(selection)}}]});
 },()=>{});
 const d=await provider.draft({content:f.content,understanding:f.understanding,rules:ruleSet},new AbortController().signal);
 assert.deepEqual(d,renderSelection(selection,input));assert.equal(calls,1);
});
