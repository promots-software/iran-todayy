import {publicationUnits} from '../../src/lib/processing/direct-publication';
import {renderingChecks} from '../../src/lib/processing/rendering-contract';
import {supportedLedger} from './fidelity-review';
export function combinedFixture(source:string,body=source,title='إيران الآن | '+body.replace(/\.$/u,'')){
 return {extraction:{relevance:'POLITICAL_NEWS',contentType:'NEWS',contentTypeEvidence:{excerpt:source,context:source},actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:source,context:source},speaker:null,kind:'FACT',material:false}],coverage:publicationUnits(source).map(u=>({unitId:u.id,nonFactual:false,factIds:['f1']})),safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}},article:{title,body,diagnostics:[]}};
}
export function reviewedFixture(source:string,publication:{id:string;text:string}[]){
 return {fidelityLedger:supportedLedger(source,publication),review:publication.map(p=>({id:p.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[],comparisons:[]};
}
