import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptIdClassification,classificationReferences,idClassificationInput,idClassificationSchema} from '../src/lib/processing/id-classification';
import {validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {GroqLanguageProvider} from '../src/lib/processing/groq';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {unknownProfile} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {buildAtoms,renderSelection} from '../src/lib/processing/constrained-rewrite';
import {finalizeConstrainedDraft} from '../src/lib/processing/local-finalization';
import {groqSchema} from '../src/lib/processing/groq-context';

const content='اجتمع المجلس في العاصمة، وقال إن الاجتماع تناول القضايا الإقليمية.';
function sample(source=content){
 const ev=(excerpt:string)=>({excerpt,context:source});
 const x=validateMinimalExtraction({relevance:'POLITICAL_NEWS',actors:[ev('المجلس')],action:ev('اجتمع'),object:ev('القضايا الإقليمية'),location:ev('العاصمة'),event_time:null,statements:[{evidence:ev(source),speaker:null}]},source);
 const c={anchorIds:classificationReferences(x).requiredAnchorIds,factLabels:[{id:'f1',kind:'FACT',material:false}],filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:['f1']};
 return {x,c};
}
test('all factual text, speakers and exact evidence are immutable local copies',()=>{
 const {x,c}=sample(),before=structuredClone(x),u=adaptIdClassification(x,c,content);
 assert.equal(u.event.object!.arabic,x.object!.excerpt);
 assert.equal(u.event.action!.arabic,x.action!.excerpt);
 assert.equal(u.event.location!.arabic,x.location!.excerpt);
 assert.deepEqual(u.event.actors.map(a=>a.evidence),x.actors);
 assert.equal(u.event.facts[0].arabic,x.statements[0].evidence.excerpt);
 assert.deepEqual(u.event.facts[0].evidence,x.statements[0].evidence);
 assert.equal(u.event.facts[0].speaker,null);
 u.event.object!.evidence.excerpt='changed output';assert.deepEqual(x,before);
});
test('rewritten object, inferred identity and free-form rationale are structurally impossible',()=>{
 const {x,c}=sample();
 for(const extra of [{object:'التطورات الإقليمية'},{actors:['الحكومة الوطنية']},{rationale:'ينتمي المجلس إلى دولة محددة'},{speakers:['وزير']},{translations:['ترجمة']},{evidence:'نص جديد'}])assert.throws(()=>adaptIdClassification(x,{...c,...extra},content),/INVALID_ID_CLASSIFICATION/);
 assert.throws(()=>adaptIdClassification(x,{...c,factLabels:[{...c.factLabels[0],arabic:'معلومة جديدة'}]},content),/INVALID_ID_CLASSIFICATION/);
 const wire=groqSchema('understand',idClassificationSchema(x));
 for(const field of ['"arabic"','"excerpt"','"speaker"','"rationale"','"key"'])assert.ok(!JSON.stringify(wire).includes(field));
});
test('missing, duplicated, unknown and cross-kind IDs are rejected',()=>{
 const {x,c}=sample();
 for(const bad of [{...c,anchorIds:c.anchorIds.slice(1)},{...c,anchorIds:c.anchorIds.map(()=>c.anchorIds[0])},{...c,anchorIds:[...c.anchorIds.slice(1),'unknown']},{...c,factLabels:[]},{...c,factLabels:[{...c.factLabels[0],id:'object'}]},{...c,rationaleIds:['unknown']}])assert.throws(()=>adaptIdClassification(x,bad,content));
});
test('unattributed narration cannot become STATEMENT or CLAIM or acquire a speaker',()=>{
 const {x,c}=sample();
 for(const kind of ['STATEMENT','CLAIM'])assert.throws(()=>adaptIdClassification(x,{...c,factLabels:[{...c.factLabels[0],kind}]},content),/INVALID_ID_CLASSIFICATION/);
 assert.equal(adaptIdClassification(x,c,content).event.facts[0].kind,'FACT');
});
test('explicit speaker is copied exactly and serious-claim review and attribution remain',()=>{
 const source='قال متحدث إن منشآتنا تضررت في العاصمة ولم يبلغ أعضاء الفريق.';
 const ev=(excerpt:string)=>({excerpt,context:source});
 const x=validateMinimalExtraction({relevance:'POLITICAL_NEWS',actors:[ev('متحدث')],action:ev('تضررت'),object:ev('منشآتنا'),location:null,event_time:null,statements:[{evidence:ev('منشآتنا تضررت في العاصمة ولم يبلغ أعضاء الفريق.'),speaker:ev('متحدث')}]},source);
 const c={...sample().c,anchorIds:classificationReferences(x).requiredAnchorIds,factLabels:[{id:'f1',kind:'STATEMENT',material:false}],seriousClaim:true};
 const u=adaptIdClassification(x,c,source);
 assert.equal(u.event.facts[0].speaker!.arabic,'متحدث');assert.deepEqual(u.event.facts[0].speaker!.evidence,x.statements[0].speaker);
 const result=finalizeConstrainedDraft(renderSelection({titleAtomId:'f1',bodyAtomIds:['f1']},buildAtoms(source,u)),source,u,unknownProfile);
 assert.ok(result.title.startsWith('إيران الآن | قال متحدث'));assert.ok(result.title.includes('منشآتنا'));
 assert.ok(!result.review.some(r=>r.code==='SERIOUS_CLAIM'));assert.ok(!result.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'));
});
test('semantic topic is selected by the model; non-UNKNOWN still requires a valid evidence ID',()=>{
 const {x,c}=sample();assert.throws(()=>adaptIdClassification(x,{...c,topic:'REGION',topicEvidenceId:null},content),/CLASSIFICATION_TOPIC_EVIDENCE_INVALID/);
 assert.equal(adaptIdClassification(x,c,content).topic,'UNKNOWN');
 const source=content+' وتناول الاجتماع أخبار غرب آسيا.';const explicit=sample(source);
 const good={...explicit.c,topic:'REGION',topicEvidenceId:'f1'};
 assert.equal(adaptIdClassification(explicit.x,good,source).topic,'REGION');
 assert.throws(()=>adaptIdClassification(explicit.x,{...good,topicEvidenceId:'missing',rationaleIds:['missing']},source),/INVALID_ID_CLASSIFICATION/);
});
test('classification preserves all facts regardless of returned label order',()=>{
 const {x,c}=sample();x.statements.push({id:'f2',evidence:x.action!,speaker:null});
 const result=adaptIdClassification(x,{...c,factLabels:[{id:'f2',kind:'FACT',material:false},...c.factLabels]},content);
 assert.deepEqual(result.event.facts.map(f=>f.id),['f1','f2']);
 assert.throws(()=>adaptIdClassification(x,{...c,factLabels:[c.factLabels[0],c.factLabels[0]]},content),/CLASSIFICATION_EVIDENCE_MISMATCH/);
});
test('unknown entity types remain unexpanded without manufacturing editorial defects',()=>{
 const {x,c}=sample(),u=adaptIdClassification(x,c,content);
 assert.deepEqual(u.uncoveredTerms,[]);assert.equal(u.event.actors[0].arabic,'المجلس');
 assert.equal(u.names.some(n=>n.kind==='institution'),false);
 const result=finalizeConstrainedDraft(renderSelection({titleAtomId:'f1',bodyAtomIds:['f1']},buildAtoms(content,u)),content,u,unknownProfile);
 assert.deepEqual(result.review.map(r=>r.code),['UNVERIFIED_SOURCE']);
 assert.ok(!result.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'));
});
test('provider calls classification only and its wire response is IDs and labels only',async()=>{
 const {x,c}=sample();const input={content,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet};let calls=0;
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{
  calls++;const req=JSON.parse(String(init?.body));
  assert.deepEqual(JSON.parse(req.contents[0].parts[0].text),idClassificationInput(x,unknownProfile));
  assert.equal(req.generationConfig.thinkingConfig.thinkingBudget,0);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(c)}]}}]});
 });
 assert.deepEqual(await provider.classifyExtracted(input,x,AbortSignal.timeout(5000)),adaptIdClassification(x,c,content));assert.equal(calls,1);
});
test('invalid evidence and unvalidated foreign-language rendering stop before AI',async()=>{
 const {x}=sample();let calls=0;
 const provider=new GroqLanguageProvider('offline',async()=>{calls++;throw new Error('unexpected API');},()=>{});
 await assert.rejects(()=>provider.classifyExtracted({content,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},{...x,object:{...x.object!,excerpt:'invented'}},AbortSignal.timeout(5000)),/INVALID_EVIDENCE/);
 const source='The council has approved the proposal.';const ev=(excerpt:string)=>({excerpt,context:source});
 const foreign=validateMinimalExtraction({relevance:'POLITICAL_NEWS',actors:[ev('council')],action:ev('approved'),object:ev('proposal'),location:null,event_time:null,statements:[{evidence:ev(source),speaker:null}]},source);
 await assert.rejects(()=>provider.classifyExtracted({content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},foreign,AbortSignal.timeout(5000)),/VALIDATED_ARABIC_RENDERING_REQUIRED/);
 assert.equal(calls,0);
});
