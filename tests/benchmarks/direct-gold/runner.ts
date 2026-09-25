import {AssumedPropositionGemini} from '../../fixtures/proposition-mock';
import {GeminiLanguageProvider,type GeminiUsage} from '../../../src/lib/processing/gemini';
import {unknownProfile,validateUnderstanding,type Understanding,ProcessingError} from '../../../src/lib/processing/contracts';
import {ruleSet} from '../../../src/lib/processing/rules';
import {directFinalArticle} from '../../../src/lib/processing/direct-generation';
import {matchEvent,type Candidate} from '../../../src/lib/processing/matcher';
import {editorialDecision} from '../../../src/lib/processing/editorial-eligibility';
import {sourceLanguage} from '../../../src/lib/processing/source-language';
import {evaluate,type Observation} from './evaluate';
import {replayTransport} from './replay';
import type {GoldCase} from './schema';
export const safeFlags={autoPublish:false,shadowMode:true,requireApproval:true} as const;
export type Adapter={mode:'replay'|'live';key:string;transport(c:GoldCase):typeof fetch;networkCount?(c:GoldCase):number};
type CaseResult={id:string;name:string;category:string;language:string;observation:Observation;findings:ReturnType<typeof evaluate>;usage:GeminiUsage[];networkRequests:number|null;simulatedRequests:number;durationMs:number|null};
export async function runCases(cases:GoldCase[],adapter:Adapter={mode:'replay',key:'offline-fixture',transport:replayTransport}){
 const events=new Map<string,Candidate>(),originals=new Map<string,string>(),results:CaseResult[]=[];
 const date=new Date('2026-01-01T00:00:00Z');
 for(const c of cases){
  const usage:GeminiUsage[]=[],started=Date.now();let understanding:Understanding|undefined;
  let o:Observation={title:'',body:'',sentences:[],facts:[],disposition:'NEEDS_REVIEW',relation:'NEW_EVENT',delivery:'HOLD',review:[]};
  try{
   const prior=c.relation.previousCaseId?events.get(c.relation.previousCaseId):undefined;
   // Mirrors the exact-original zero-call early duplicate guard; never reads DB.
   if(c.relation.previousCaseId&&originals.get(c.relation.previousCaseId)===c.sourceText&&prior){o={...o,disposition:'DUPLICATE',relation:'DUPLICATE'};}
   else{
    const provider=new (adapter.mode==='replay'?AssumedPropositionGemini:GeminiLanguageProvider)(adapter.key,adapter.transport(c),u=>{usage.push(u);});
    const profile={...unknownProfile,verified:true,flagged:c.replay.flagged,classification:'NEUTRAL' as const,authority:'AGENCY' as const};
    const signal=AbortSignal.timeout(180000);
    understanding=validateUnderstanding(await provider.understand({content:c.sourceText,publishedAt:date,profile,rules:ruleSet,processingMode:'DIRECT',comparisonCandidates:prior?[prior.data]:[]},signal),c.sourceText);
    directFinalArticle(c.sourceText,understanding);
    const match=await matchEvent(understanding.event,date,prior?[prior]:[],provider,signal,{source:c.sourceText,understanding,processingMode:'DIRECT'});
    o.relation=match.classification;o.facts=understanding.event.facts.map(f=>({id:f.id,excerpt:f.evidence.excerpt}));
    if(match.classification==='DUPLICATE')o.disposition='DUPLICATE';
    else if(match.classification==='UNCERTAIN_MATCH'){o.disposition='NEEDS_REVIEW';o.review=['UNCERTAIN_MATCH'];}
    else{
     await provider.draft({processingMode:'DIRECT',content:c.sourceText,understanding,rules:ruleSet},signal);
     const d=directFinalArticle(c.sourceText,understanding);
     const decision=editorialDecision({validated:true,review:d.review},safeFlags);
     o={title:d.title,body:d.body,sentences:d.sentenceEvidence,facts:o.facts,disposition:decision.editorialEligibility,relation:match.classification,delivery:decision.deliveryDecision,review:d.review.map(r=>r.code+(r.detail?': '+r.detail:''))};
    }
    events.set(c.id,{id:c.id,revisionId:c.id,revision:1,publishedAt:date,data:understanding.event,published:false});
    originals.set(c.id,c.sourceText);
   }
  }catch(e){o.error=e instanceof ProcessingError?e.code:e instanceof Error&&e.name==='ZodError'?'SCHEMA_ERROR':'BENCHMARK_PIPELINE_ERROR';o.review=[o.error];}
  const findings=evaluate(c,o);
  results.push({id:c.id,name:c.name,category:c.category,language:sourceLanguage(c.sourceText),observation:o,findings,usage,networkRequests:adapter.mode==='replay'?0:adapter.networkCount?.(c)??null,simulatedRequests:adapter.mode==='replay'?usage.length:0,durationMs:adapter.mode==='replay'?null:Date.now()-started});
 }
 const counts=(kind:string)=>results.flatMap(r=>r.findings).filter(f=>f.kind===kind).length;
 return {mode:adapter.mode,qualification:'NOT_LAUNCH_QUALIFIED',humanGoldSignoff:false,modelQualityMeasured:adapter.mode==='live',caseCount:results.length,passingCases:results.filter(r=>!r.findings.length).length,criticalSemanticFailures:counts('CRITICAL'),qualityFailures:counts('QUALITY'),technicalFailures:counts('TECHNICAL'),unverifiedSemanticFindings:counts('UNVERIFIED'),networkRequests:results.some(r=>r.networkRequests===null)?null:results.reduce((n,r)=>n+(r.networkRequests??0),0),simulatedRequests:results.reduce((n,r)=>n+r.simulatedRequests,0),inputTokens:results.flatMap(r=>r.usage).reduce((n,u)=>n+(u.inputTokens??0),0),outputTokens:results.flatMap(r=>r.usage).reduce((n,u)=>n+(u.outputTokens??0),0),estimatedCostUsd:results.flatMap(r=>r.usage).reduce((n,u)=>n+(u.estimatedCostUsd??0),0),unmeasuredUsageResults:results.flatMap(r=>r.usage).filter(u=>u.estimatedCostUsd===null).length,results};
}
