import test from 'node:test';
import assert from 'node:assert/strict';
import {extractionTask} from '../src/lib/processing/gemini-benchmark-prompt';
import {validateMinimalExtraction,requireCompleteExtraction,minimalExtractionSchema} from '../src/lib/processing/groq-extraction';
import {groqSchema} from '../src/lib/processing/groq-context';
test('ordinary unattributed assertions remain exact evidence across supported languages',()=>{
 for(const source of ['أقر المجلس الخطة.','The council approved the plan.','شورا این طرح را تصویب کرده است.']){
  const span={excerpt:source,context:source};
  const raw={relevance:'POLITICAL_NEWS',actors:[span],action:span,object:null,location:null,event_time:null,statements:[{evidence:span,speaker:null}]};
  const x=validateMinimalExtraction(raw,source);requireCompleteExtraction(x);assert.equal(x.statements[0].evidence.excerpt,source);assert.equal(x.statements[0].speaker,null);
  assert.throws(()=>requireCompleteExtraction(validateMinimalExtraction({...raw,statements:[]},source)),/INCOMPLETE_EXTRACTION/);
  assert.throws(()=>validateMinimalExtraction({...raw,statements:[{evidence:{...span,excerpt:'invented'},speaker:null}]},source));
 }
});
test('prompt and wire schema distinguish anchors from narrated assertions without fallback',()=>{
 assert.ok(extractionTask.includes('they do not replace statements'));
 assert.ok(extractionTask.includes('speaker=null for unattributed narration'));
 assert.ok(extractionTask.includes('never manufacture a fallback statement'));
 assert.ok(!extractionTask.includes('translations, facts, IDs'));
 const schema=groqSchema('understand',minimalExtractionSchema) as unknown as {properties:{statements:{description:string}}};
 assert.ok(schema.properties.statements.description.includes('Anchors do not satisfy'));
});
