import {supportedLedger} from './fixtures/fidelity-review';
import test from 'node:test';
import assert from 'node:assert/strict';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {unknownProfile,validateUnderstanding} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {publicationUnits} from '../src/lib/processing/direct-publication';
import {directFinalArticle,assertIndependentDirectReview} from '../src/lib/processing/direct-generation';
import {renderingChecks} from '../src/lib/processing/rendering-contract';
import {editorialContract} from '../src/lib/processing/editorial-contract';
import {matchEvent} from '../src/lib/processing/matcher';
import {directComparisonInputs,directComparisonKey,validateDirectComparisons} from '../src/lib/processing/direct-two-stage';
const article={title:'إيران الآن | افتتاح مدرسة جديدة',body:'افتتح المجلس مدرسة جديدة.',diagnostics:[]};
const signal=()=>new AbortController().signal;
const response=(v:unknown)=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(v)}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,thoughtsTokenCount:0}});
function setup(source:string,failure?:string){
 const calls:string[]=[];
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const r=JSON.parse(String(init?.body)),data=JSON.parse(r.contents[0].parts[0].text);
  assert.equal(r.systemInstruction.parts[0].text.split(editorialContract).length,2);
  if(r.generationConfig.responseJsonSchema.properties.extraction){
   calls.push('combined');assert.equal(data.content,source);
   return response({extraction:{relevance:'POLITICAL_NEWS',contentType:'NEWS',contentTypeEvidence:{excerpt:source,context:source},actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:source,context:source},speaker:null,kind:'FACT',material:false}],coverage:publicationUnits(source).map(u=>({unitId:u.id,nonFactual:false,factIds:['f1']})),safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}},article});
  }
  calls.push('independent');assert.equal(data.originalSource,source);assert.equal(data.validatedEvidence.facts[0].evidence.excerpt,source);
  return response({fidelityLedger:supportedLedger(source,data.publication),review:data.publication.map((v:{id:string})=>({id:v.id,verdict:failure?'UNSUPPORTED':'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,!failure])),issues:failure?[failure]:[]})),fullSourceCovered:!failure,publicationQuality:!failure,issues:failure?[failure]:[],comparisons:data.comparisons.map((c:{id:string})=>({id:c.id,decision:{relation:'SAME',newFactIds:[],conflictingFactIds:[],rationale:'نفس الحدث دون معلومة جديدة',identity:{basis:'SAME_OCCURRENCE',incomingFactIds:['f1'],existingFactIds:['f1'],explanation:'Explicit fixture same-event verdict'}}}))});
 });
 return {p,calls,input:{processingMode:'DIRECT' as const,content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet}};
}
for(const source of ['افتتح المجلس مدرسة جديدة.','شورای شهر مدرسه جدیدی افتتاح کرد.','The council opened a new school.'])test('DIRECT combined generation + independent review exactly twice: '+source,async()=>{
 const {p,calls,input}=setup(source),u=validateUnderstanding(await p.understand(input,signal()),source);
 assert.equal(u.directGeneration?.semanticVerification,'INDEPENDENT');
 await p.draft({...input,understanding:u},signal());assert.deepEqual(calls,['combined','independent']);
 assert.equal(directFinalArticle(source,u).body,article.body);
 const reordered=JSON.parse(JSON.stringify(u,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
 assert.equal(directFinalArticle(source,reordered).body,article.body);
 u.directGeneration!.article.body+=' معلومة أخرى.';assert.throws(()=>directFinalArticle(source,u),/RECEIPT_CHANGED/);
});
for(const failure of ['UNSUPPORTED_ADDITION','MATERIAL_OMISSION','CHANGED_QUANTITY_UNIT','CHANGED_MODALITY','INVENTED_ATTRIBUTION','CANONICAL_PADDING'])test('independent '+failure+' fails closed without third call',async()=>{
 const {p,calls,input}=setup('افتتح المجلس مدرسة جديدة.',failure);
 await assert.rejects(p.understand(input,signal()),/DIRECT_PUBLICATION_UNSUPPORTED/);
 assert.deepEqual(calls,['combined','independent']);
});
test('DIRECT cannot silently issue an unreviewed third matching request',async()=>{
 const {p,calls,input}=setup('افتتح المجلس مدرسة جديدة.');
 const u=validateUnderstanding(await p.understand(input,signal()),input.content);
 assert.throws(()=>p.compare({incoming:u.event,existing:u.event},signal()),/DIRECT_MATCH_REVIEW_REQUIRED/);
 assert.equal(calls.length,2);
});

for(const field of renderingChecks)test(`a single failed independent ${field} check blocks an otherwise positive review`,()=>{
 const checks=Object.fromEntries(renderingChecks.map(k=>[k,true]));
 const review={review:['title','body:1'].map(id=>({id,verdict:'SUPPORTED',checks:{...checks},issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[]};
 review.review[1].checks[field]=false;
 assert.throws(()=>assertIndependentDirectReview(review,article),/DIRECT_PUBLICATION_UNSUPPORTED/);
});
for(const field of ['fullSourceCovered','publicationQuality'] as const)test(`independent ${field} cannot be omitted or false`,()=>{
 const review={review:['title','body:1'].map(id=>({id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[]};
 assert.throws(()=>assertIndependentDirectReview({...review,[field]:false},article));
 const missing:Record<string,unknown>={...review};delete missing[field];
 assert.throws(()=>assertIndependentDirectReview(missing,article));
});

test('existing typed soft diagnostics are not factual failures; unknown or material issues still block',()=>{
 const review={review:['title','body:1'].map(id=>({id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:['SOFT:STYLE']})),fullSourceCovered:true,publicationQuality:true,issues:['SOFT:STYLE']};
 assert.doesNotThrow(()=>assertIndependentDirectReview(review,article));
 assert.throws(()=>assertIndependentDirectReview({...review,issues:['UNKNOWN_ADDITION']},article));
 review.review[1].checks.numbers=false;
 assert.throws(()=>assertIndependentDirectReview(review,article));
});
test('semantic duplicate comparison is included in independent request, with no third network call',async()=>{
 const source='افتتح المجلس مدرسة جديدة.';
 const first=setup(source),prior=validateUnderstanding(await first.p.understand(first.input,signal()),source).event;
 prior.summary='صياغة أقدم للحدث'; // Same fact identity, a non-identical stored representation.
 const {p,calls,input}=setup(source);
 const u=validateUnderstanding(await p.understand({...input,comparisonCandidates:[prior,structuredClone(prior)]},signal()),source);
 for(const fact of u.event.facts)fact.evidence.sourcePostId='local-assigned-id';
 const result=await p.compare({incoming:u.event,existing:prior},signal());
 assert.equal(Object(result).relation,'SAME');assert.equal(calls.length,2);
 const persisted=validateUnderstanding(JSON.parse(JSON.stringify(u)),source);
 const restarted=setup(source).p;restarted.compare=async()=>{throw new Error('FORBIDDEN_THIRD_CALL');};
 const match=await matchEvent(persisted.event,new Date(),[{id:'saved-event',revisionId:'saved-revision',revision:1,publishedAt:new Date(),published:false,data:prior}],restarted,signal(),{source,understanding:persisted,processingMode:'DIRECT'});
 assert.equal(match.classification,'DUPLICATE');
 assert.equal(directComparisonInputs(u.event,[prior,prior]).length,1);
 assert.equal(directComparisonInputs(u.event,[u.event]).length,0);
 const entries=directComparisonInputs(u.event,[prior]);
 const receipt={review:[],fullSourceCovered:true,publicationQuality:true,issues:[],comparisons:[{id:directComparisonKey(u.event,prior),decision:{relation:'SAME' as const,newFactIds:['invented'],conflictingFactIds:[],rationale:'غير صالح'}}]};
 assert.throws(()=>validateDirectComparisons(receipt,entries,u),/INVALID_COMPARISON_EVIDENCE/);
});
