import {bindingMock} from './binding-wire';
import {ProcessingError} from '../../src/lib/processing/contracts';
import {GeminiLanguageProvider} from '../../src/lib/processing/gemini';
import type {PropositionInventory,PropositionUnit} from '../../src/lib/processing/proposition-support';
/** Explicit legacy-fixture oracle ONLY. This does not evaluate semantics.
 * Its assumed-supported verdicts let older tests exercise their original
 * non-proposition layer. Real V4.4 decisions use separately frozen regressions. */
export function assumedPropositionResponse(data:Record<string,unknown>):unknown{
 if(data.version!=='proposition-support-v4.4')return undefined;
 if(Array.isArray(data.units))return {propositions:(data.units as PropositionUnit[]).map((u,i)=>({id:'p'+(i+1),evidence:{unitId:u.id,start:0,end:u.text.length,excerpt:u.text},actor:'',action:u.text,objectContext:'',speaker:'',attribution:'NARRATOR',state:{reference:'UNSPECIFIED',referenceText:'',phase:'UNSPECIFIED',continuity:'UNSPECIFIED',certainty:'ASSERTED',polarity:'POSITIVE'},relations:[],explanation:'Explicit offline assumed-support oracle'})),unresolved:[]};
 const source=data.source as {inventory:PropositionInventory},candidate=data.candidate as {inventory:PropositionInventory};
 const support=source.inventory.propositions.map((_,i)=>({kind:'SOURCE_PROPOSITION',supportId:'source:proposition:'+i}));
 if(Array.isArray(data.targetManifest))return {assessments:(data.targetManifest as {id:string;evidence:unknown}[]).map(t=>({targetId:t.id,candidateEvidence:t.evidence,state:'SUPPORTED',sufficientGroups:[support],defects:[],explanation:'Explicit offline assumed support'}))};
 return {judgments:candidate.inventory.propositions.map(p=>({candidateId:p.id,verdict:'SUPPORTED',explanation:'Explicit offline assumed support',sourceSupports:support,issues:[]})),relationAssessments:[],overall:'SUPPORTED'};
}
export function withAssumedPropositionSupport(transport:typeof fetch):typeof fetch{return async(url,init)=>{
 const body=JSON.parse(String(init?.body)),native=!!body.contents,data=JSON.parse(native?body.contents[0].parts[0].text:body.messages[1].content),output=assumedPropositionResponse(data);
 if(output===undefined)return native?bindingMock(transport)(url,init):transport(url,init);
 return Response.json(native?{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:0,candidatesTokenCount:0,thoughtsTokenCount:0}}:{choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
};}
/** A name that makes the extra mocked stages explicit at imports. */
export class AssumedPropositionGemini extends GeminiLanguageProvider{
 private resume:GeminiLanguageProvider|null=null;
 private factory:()=>GeminiLanguageProvider;
 constructor(key:string,transport:typeof fetch,log?:ConstructorParameters<typeof GeminiLanguageProvider>[2]){
  const mocked=withAssumedPropositionSupport(transport),cache=new Map<string,{body:string;status:number}>();
  const checkpointed:typeof fetch=async(url,init)=>{const key=String(init?.body),old=cache.get(key);if(old)return new Response(old.body,{status:old.status,headers:{'x-worker-checkpoint-replayed':'true'}});const response=await mocked(url,init);if(response.ok)cache.set(key,{body:await response.clone().text(),status:response.status});return response;};
  super(key,checkpointed,log);this.factory=()=>new GeminiLanguageProvider(key,checkpointed,log);
 }
 // Simulate one durable worker continuation when the unchanged eight-request
 // ceiling is reached. The dedicated integration test verifies actual boundaries.
 override async understand(...args:Parameters<GeminiLanguageProvider['understand']>){try{return await (this.resume?this.resume.understand(...args):super.understand(...args));}catch(e){if(!(e instanceof ProcessingError)||e.code!=='APPLICATION_CONTINUATION_BUDGET'||this.resume)throw e;this.resume=this.factory();return this.resume.understand(...args);}}
 override async draft(...args:Parameters<GeminiLanguageProvider['draft']>){try{return await (this.resume?this.resume.draft(...args):super.draft(...args));}catch(e){if(!(e instanceof ProcessingError)||e.code!=='APPLICATION_CONTINUATION_BUDGET'||this.resume)throw e;this.resume=this.factory();return this.resume.draft(...args);}}
}
