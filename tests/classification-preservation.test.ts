import test from 'node:test';
import assert from 'node:assert/strict';
import {classificationSchemaFor,validateMinimalExtraction,adaptClassification} from '../src/lib/processing/groq-extraction';
import {supportedClassificationTopics} from '../src/lib/processing/classification-grounding';
import {GroqLanguageProvider} from '../src/lib/processing/groq';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {groqSchema} from '../src/lib/processing/groq-context';
import {ruleSet} from '../src/lib/processing/rules';
import {unknownProfile} from '../src/lib/processing/contracts';
import {classificationReferences,idClassificationInput} from '../src/lib/processing/id-classification';

const source='اجتمع المجلس لمناقشة القضايا الإقليمية في العاصمة، وقال إن الاجتماع انتهى.';
const ev=(excerpt:string)=>({excerpt,context:source});
function data(){
 const x=validateMinimalExtraction({relevance:'POLITICAL_NEWS',actors:[ev('المجلس')],action:ev('اجتمع'),object:ev('القضايا الإقليمية'),location:null,event_time:null,statements:[{evidence:ev(source),speaker:null}]},source);
 const label=(arabic:string)=>({key:arabic,arabic,nameKind:null});
 const c={filterReason:'NONE',topic:'UNKNOWN',priority:'P2',rationale:'اجتماع سياسي لا يحدد منطقة بعينها.',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,uncoveredTerms:[],topicEvidence:null,actors:[label('المجلس')],action:label('اجتمع'),object:label('القضايا الإقليمية'),location:null,statements:[{id:'f1',key:'council-meeting',arabic:source,kind:'FACT',material:true,speaker:null}]};
 return {x,c,label};
}
test('classification preserves present anchors and cannot invent absent anchors',()=>{
 const {x,c,label}=data();
 const schema=classificationSchemaFor(x);
 assert.ok(schema.safeParse(c).success);
 for(const field of ['action','object'] as const)assert.equal(schema.safeParse({...c,[field]:null}).success,false);
 assert.equal(schema.safeParse({...c,location:label('مكان')}).success,false);
 assert.throws(()=>adaptClassification(x,{...c,object:null},source,'ar'),/CLASSIFICATION_EVIDENCE_MISMATCH/);
 const withLocation={...x,location:x.object};
 assert.equal(classificationSchemaFor(withLocation).safeParse(c).success,false);
 assert.ok(classificationSchemaFor(withLocation).safeParse({...c,location:c.object}).success);
});
test('classification preserves actor/fact counts, fact IDs and speaker presence',()=>{
 const {x,c,label}=data();const schema=classificationSchemaFor(x);
 assert.equal(schema.safeParse({...c,actors:[]}).success,false);
 assert.equal(schema.safeParse({...c,statements:[]}).success,false);
 assert.equal(schema.safeParse({...c,statements:[{...c.statements[0],id:'invented'}]}).success,false);
 assert.equal(schema.safeParse({...c,statements:[{...c.statements[0],speaker:label('مسؤول')}]}).success,false);
 const attributed={...x,statements:[{...x.statements[0],speaker:x.actors[0]}]};
 assert.equal(classificationSchemaFor(attributed).safeParse(c).success,false);
 assert.ok(classificationSchemaFor(attributed).safeParse({...c,statements:[{...c.statements[0],speaker:c.actors[0]}]}).success);
});
test('generic regional wording does not select geography; explicit evidence uses unchanged topic rules',()=>{
 const {x,c}=data();const schema=classificationSchemaFor(x);
 assert.equal(schema.safeParse({...c,topic:'REGION',topicEvidence:'القضايا الإقليمية'}).success,false);
 assert.throws(()=>adaptClassification(x,{...c,topic:'REGION',topicEvidence:'القضايا الإقليمية'},source,'ar'),/CLASSIFICATION_ENTITY_UNSUPPORTED/);
 assert.ok(schema.safeParse(c).success);
 const topics=['UNKNOWN','REGION','IRAN_DOMESTIC','ISRAEL','WEST'] as const;
 assert.deepEqual(supportedClassificationTopics(topics,['Regional talks']),['UNKNOWN']);
 assert.deepEqual(supportedClassificationTopics(topics,['West Asia talks']),['UNKNOWN','REGION']);
 assert.deepEqual(supportedClassificationTopics(topics,['گفتگو در ایران']),['UNKNOWN','IRAN_DOMESTIC']);
 assert.deepEqual(supportedClassificationTopics(topics,['أعلنت إسرائيل قرارا']),['UNKNOWN','ISRAEL']);
 assert.deepEqual(supportedClassificationTopics(topics,['European talks']),['UNKNOWN','WEST']);
});
test('wire schema retains non-null anchors and evidence-limited topics',()=>{
 const {x}=data();const wire=groqSchema('understand',classificationSchemaFor(x)) as {properties:Record<string,{type?:string;enum?:string[];anyOf?:unknown[]}>};
 assert.equal(wire.properties.object.type,'object');
 assert.equal(wire.properties.location.type,'null');
 assert.ok(wire.properties.topic.enum!.includes('UNKNOWN'));
 assert.ok(!wire.properties.topic.enum!.includes('REGION'));
});
test('saved extraction resumes classification only on shared and Gemini providers',async()=>{
 const {x,c}=data();const input={content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet};
 const ids={anchorIds:classificationReferences(x).requiredAnchorIds,factLabels:[{id:'f1',kind:'FACT',material:true}],filterReason:c.filterReason,topic:c.topic,topicEvidenceId:null,priority:c.priority,sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:['f1']};
 let calls=0;
 const groq=new GroqLanguageProvider('offline',async(_url,init)=>{
  calls++;const request=JSON.parse(String(init?.body));
  assert.equal(request.response_format.json_schema.name,'iran_today_classify');
  assert.deepEqual(JSON.parse(request.messages[1].content),idClassificationInput(x,unknownProfile));
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(ids)}}]});
 },()=>{});
 const result=await groq.classifyExtracted(input,x,AbortSignal.timeout(5000));
 assert.equal(calls,1);assert.equal(result.event.object?.evidence.excerpt,'القضايا الإقليمية');
 let geminiCalls=0;
 const gemini=new GeminiLanguageProvider('offline',async(_url,init)=>{
  geminiCalls++;const request=JSON.parse(String(init?.body));
  assert.deepEqual(JSON.parse(request.contents[0].parts[0].text),idClassificationInput(x,unknownProfile));
  assert.equal(request.generationConfig.thinkingConfig.thinkingBudget,0);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(ids)}]}}]});
 });
 assert.deepEqual(await gemini.classifyExtracted(input,x,AbortSignal.timeout(5000)),result);
 assert.equal(geminiCalls,1);
});
test('invalid saved evidence is rejected locally before any classification request',async()=>{
 const {x}=data();let calls=0;
 const provider=new GroqLanguageProvider('offline',async()=>{calls++;throw new Error('unexpected network');},()=>{});
 await assert.rejects(()=>provider.classifyExtracted({content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},{...x,object:{...x.object!,excerpt:'invented'}},AbortSignal.timeout(5000)),/EVIDENCE/);
 assert.equal(calls,0);
});
