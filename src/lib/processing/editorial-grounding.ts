import {checkEvidence,ProcessingError,validateUnderstanding,type Understanding} from './contracts';
import {resolveRendering,type RenderingReference} from './evidence-rendering';
import {validateExtractionLanguageAndSpeakers} from './groq-validation';

/** Proof of faithful copying/validated translation, NOT independent truth or human approval. */
export function validateEditorialGrounding(u:Understanding,source:string){
 validateUnderstanding(u,source);validateExtractionLanguageAndSpeakers(u,source);
 if(!u.event.facts.length)throw new ProcessingError('INCOMPLETE_EXTRACTION');
 const entries=[...u.event.actors.map((value,i)=>({id:`actor:${i+1}`,value})),
 ...(['action','object','location'] as const).flatMap(id=>u.event[id]?[{id,value:u.event[id]!}]:[]),
 ...u.event.facts.flatMap(value=>[{id:value.id,value},...(value.speaker?[{id:`${value.id}:speaker`,value:value.speaker}]:[])])];
 for(const name of u.names){
  const linked=entries.find(e=>e.value.evidence.start===name.evidence.start&&e.value.evidence.end===name.evidence.end&&e.value.arabic===name.arabic);
  if(!linked)throw new ProcessingError('IDENTITY_AMBIGUOUS');
 }
 const receipt=u.rendering;
 for(const {id,value:entry} of entries){
  checkEvidence(source,entry.evidence);
  if(u.language==='ar'){
   if(entry.arabic!==entry.evidence.excerpt)throw new ProcessingError('UNSUPPORTED_OUTPUT');
  }else{
   const rendered=receipt?.entries.find(e=>e.id===id&&e.arabic===entry.arabic);
   if(!rendered)throw new ProcessingError('VALIDATED_ARABIC_RENDERING_REQUIRED');
   const ref:RenderingReference={id:rendered.id,role:'editorial',evidence:entry.evidence};
   resolveRendering(source,[ref],receipt);
  }
 }
}
export function hasEditorialGrounding(u:Understanding,source?:string){
 if(!source)return false;
 try{validateEditorialGrounding(u,source);return true;}catch{return false;}
}
/** Older classifier versions labelled every unknown anchor as an uncovered term. */
export function unresolvedTerms(u:Understanding,source:string|undefined){
 if(!hasEditorialGrounding(u,source))return u.uncoveredTerms;
 const copied=[...u.event.actors,u.event.location,...u.event.facts.map(f=>f.speaker)].filter(x=>x!==null);
 return u.uncoveredTerms.filter(term=>!copied.some(e=>e.evidence.excerpt===term||e.arabic===term));
}
