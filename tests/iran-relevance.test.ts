import test from 'node:test';
import assert from 'node:assert/strict';
import {AssumedPropositionGemini as GeminiLanguageProvider} from './fixtures/proposition-mock';
import {unknownProfile} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {iranRelevanceInstructions} from '../src/lib/processing/iran-relevance';
import {publicationUnits} from '../src/lib/processing/direct-publication';
// These tests prove routing/contract isolation with an explicit mocked semantic
// verdict, NOT the model's ability to determine relevance (the live gate does).
import productionCases from './fixtures/iran-relevance-production.json';
const cases=[
 ['Iranian source / Iran event','التقى وزير الخارجية الإيراني نظيره العراقي في بغداد.',true,true],
 ['Iranian source / foreign event','بحث وزيرا فرنسا وألمانيا العلاقات بين بلديهما.',false,true],
 ['foreign source / Iran event','بحث المسؤولون العقوبات المفروضة على إيران.',true,false],
 ['Iran only in footer','افتتح المجلس البلدي في باريس مكتبة عامة جديدة.\n@Iran_news',false,true],
 ['irrelevant hashtag','وقعت الحكومة الكندية اتفاقاً تجارياً جديداً مع الحكومة المكسيكية.\n#إيران',false,true],
 ['foreign action targeting Iran','فرضت الحكومة البريطانية عقوبات على مؤسسة إيرانية.',true,false],
 ['Iranian official bilateral','التقى الرئيس الإيراني مسعود بزشكيان رئيس الوزراء الأرميني.',true,true],
 ['generic regional news','اتفقت السعودية واليمن على استئناف مشاوراتهما الثنائية.',false,true],
 ['speculative connection not evidence','اجتمع وزيرا تركيا والعراق لبحث تعاونهما الأمني.',false,false],
 ['grounded Iran news continues downstream','افتتحت وزارة التعليم الإيرانية مدرسة جديدة في طهران.',true,false],
...productionCases.map(r=>[`${r.source}/${r.telegramId}`,r.originalContent,false,false] as const),
] as const;
for(const [name,source,relevant,iranianSource] of cases)test('NORMAL semantic relevance routing: '+name,async()=>{
 const calls:string[]=[];
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const r=JSON.parse(String(init?.body)),schema=r.generationConfig.responseJsonSchema,data=JSON.parse(r.contents[0].parts[0].text);
  let value:unknown;
  if(schema.properties.contentType){
   calls.push('extract');assert.equal(data.content,source);assert(r.systemInstruction.parts[0].text.includes(iranRelevanceInstructions));
   assert(r.systemInstruction.parts[0].text.endsWith(iranRelevanceInstructions));
   value={relevance:relevant?'POLITICAL_NEWS':'IRRELEVANT',contentType:'NEWS',contentTypeEvidence:{excerpt:source,context:source},coverage:publicationUnits(source).map(u=>({unitId:u.id,factIds:['f1'],nonFactual:false})),actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:source,context:source},speaker:null}]};
  }else{
   calls.push('classify');assert(relevant);value={anchorIds:[],factLabels:[{id:'f1',kind:'FACT',material:false}],filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:['f1']};
  }
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}});
 });
 const profile={...unknownProfile,verified:iranianSource,evidence:iranianSource?'Iranian agency identity only':'Foreign source identity only'};
 const u=await p.understand({content:source,publishedAt:new Date(),profile,rules:ruleSet},new AbortController().signal);
 assert.equal(u.relevance,relevant?'POLITICAL_NEWS':'IRRELEVANT');assert.deepEqual(calls,relevant?['extract','classify']:['extract']);
 if(!relevant){assert.equal(u.filterReason,'UNRELATED_TO_IRAN');await assert.rejects(p.draft({content:source,understanding:u,rules:ruleSet},new AbortController().signal),/DRAFT_NOT_ACCEPTED/);assert.deepEqual(calls,['extract']);}
});
