import {supportedLedger} from './fidelity-review';
import {renderingChecks} from '../../src/lib/processing/rendering-contract';

/** Mock wire contract only: these verdicts are test inputs, never evidence of
 * a live model's semantic accuracy. No network or production data is used. */
export function reviewedResponse(request:{generationConfig:{responseJsonSchema:{properties:Record<string,unknown>}};contents:Array<{parts:Array<{text:string}>}>},extraction:unknown,article:unknown,relation:'SAME'|'DIFFERENT'|'UNCERTAIN'='DIFFERENT'){
 const input=JSON.parse(request.contents[0].parts[0].text);
 if(request.generationConfig.responseJsonSchema.properties.extraction)return {extraction:{...Object(extraction),relevance:'POLITICAL_NEWS',contentType:'NEWS',contentTypeEvidence:{excerpt:input.content,context:input.content}},article};
 const data=JSON.parse(request.contents[0].parts[0].text) as {originalSource:string;publication:Array<{id:string;text:string}>;incoming:{facts:{id:string}[]};comparisons:Array<{id:string;existing:{facts:{id:string}[]}}>};
 return {fidelityLedger:supportedLedger(data.originalSource,data.publication),review:data.publication.map(p=>({id:p.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[],comparisons:data.comparisons.map(c=>({id:c.id,decision:{relation,identity:{basis:relation==='SAME'?'SAME_OCCURRENCE':relation==='DIFFERENT'?'DIFFERENT_OCCURRENCE':'UNRESOLVED',incomingFactIds:data.incoming.facts.map(f=>f.id),existingFactIds:c.existing.facts.map(f=>f.id),explanation:'Fixture event identity'},rationale:'مقارنة اختبار محلية',newFactIds:[],conflictingFactIds:[]}}))};
}
