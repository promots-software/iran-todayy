import {renderingChecks} from '../../src/lib/processing/rendering-contract';
import {prepareDirectBilingual,sourceCoverageUnits} from '../../src/lib/processing/direct-bilingual';
export function bilingualFixture(language:'fa'|'en'='fa'){
 const source=language==='fa'?'شورا ۱۲ مدرسه جدید را در پایتخت افتتاح کرد.':'The council opened 12 new schools in the capital.';
 const e=(excerpt:string,arabic:string)=>({excerpt,context:source,arabic});
 const raw={actors:[e(language==='fa'?'شورا':'council','المجلس')],action:e(language==='fa'?'افتتاح کرد':'opened','افتتح'),object:e(language==='fa'?'۱۲ مدرسه جدید':'12 new schools','12 مدرسة جديدة'),location:e(language==='fa'?'پایتخت':'capital','العاصمة'),event_time:null,
 statements:[{evidence:e(source,'افتتح المجلس 12 مدرسة جديدة في العاصمة.'),speaker:null,kind:'FACT',material:false}],
 safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}};
 return {source,raw};
}
export function passingReview(source:string,p:ReturnType<typeof prepareDirectBilingual>){
 return {review:p.refs.map(r=>({id:r.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[] as string[]})),coverage:{complete:true,units:sourceCoverageUnits(source).map(u=>({id:u.id,verdict:'COVERED',factIds:p.grounded.extraction.statements.filter(f=>[f.evidence,f.speaker].some(e=>e&&e.start<u.end&&e.end>u.start)).map(f=>f.id),reason:'All material assertions retained'}))}};
}
export function geminiEnvelope(value:unknown,finishReason='STOP'){return {candidates:[{finishReason,content:{parts:[{text:JSON.stringify(value)}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:100,thoughtsTokenCount:0}};}
