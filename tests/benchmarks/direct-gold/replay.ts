import type {GoldCase} from './schema';
import {publicationUnits} from '../../../src/lib/processing/direct-publication';
import {prepareDirectBilingual} from '../../../src/lib/processing/direct-bilingual';
import {passingReview,geminiEnvelope} from '../../fixtures/direct-bilingual';
import {renderingChecks} from '../../../src/lib/processing/rendering-contract';
/** Authored stub values, NOT captured Gemini responses or evidence of model quality. */
export function replayExtraction(c:GoldCase){
 const evidence=(excerpt:string,arabic?:string,localContext?:string)=>{
  const context=localContext??c.sourceText.split('\n').find(line=>line.includes(excerpt))??c.sourceText;
  return {excerpt,context,...(c.language==='ar'?{}:{arabic:arabic??c.replay.anchorArabic[excerpt]??excerpt})};
 };
 const statements=c.materialFacts.map((f,i)=>{
  const speaker=c.replay.speakers.find(s=>f.sourceExcerpt.includes(s)&&/(?:قال|أعلن|أوضح|أضاف|اعلام کرد)/u.test(f.sourceExcerpt));
  return {evidence:evidence(f.sourceExcerpt,c.replay.arabicFacts[i]),speaker:speaker?evidence(speaker,undefined,f.sourceExcerpt):null,kind:speaker?'STATEMENT':'FACT',material:true};
 });
 const base={actors:c.replay.actors.map(a=>evidence(a)),action:evidence(c.replay.action),object:evidence(c.replay.object),location:c.replay.location?evidence(c.replay.location):null,event_time:null,statements,safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:c.replay.seriousClaim,rankUnverified:false}};
 if(c.language!=='ar')return base;
 const publication=c.replay.publication??{title:{text:c.replay.arabicFacts[0].replace(/\.$/u,''),factIds:['f1']},body:c.materialFacts.length>1?c.replay.arabicFacts.map((text,i)=>({text,factIds:[`f${i+1}`]})):[]};
 return {...base,publication,coverage:publicationUnits(c.sourceText).map(unit=>{const facts=c.materialFacts.filter(f=>unit.text.includes(f.sourceExcerpt));return {unitId:unit.id,nonFactual:!facts.length&&/^@/u.test(unit.text),factIds:facts.map(f=>f.id)};})};
}
export function replayTransport(c:GoldCase):typeof fetch{
 const raw=replayExtraction(c);
 return async(_url,init)=>{
  const request=JSON.parse(String(init?.body)),properties=request.generationConfig.responseJsonSchema.properties;
  let value:unknown;
  if(properties.statements)value=raw;
  else if(properties.relation){const input=JSON.parse(request.contents[0].parts[0].text);value={...(c.replay.comparison??{relation:'SAME',newFactIds:[],conflictingFactIds:[],rationale:'نفس الحقائق المثبتة'}),identity:{basis:'SAME_OCCURRENCE',incomingFactIds:input.incoming.facts.map((f:{id:string})=>f.id),existingFactIds:input.existing.facts.map((f:{id:string})=>f.id),explanation:'Authored fixture asserts the same occurrence, not model-quality evidence.'}};}
  else if(properties.publication)value={
   publication:c.replay.publication??{title:{text:'إيران الآن | '+c.replay.arabicFacts[0].replace(/\.$/u,''),factIds:['f1']},body:c.materialFacts.length>1?c.replay.arabicFacts.map((text,i)=>({text,factIds:[`f${i+1}`]})):[]},
   coverage:publicationUnits(c.sourceText).map(unit=>({unitId:unit.id,nonFactual:false,factIds:c.materialFacts.filter(f=>unit.text.includes(f.sourceExcerpt)).map(f=>f.id)})),
  };
  else if(c.language!=='ar'&&!properties.fullSourceCovered)value=passingReview(c.sourceText,prepareDirectBilingual(raw,c.sourceText));
  else {
   const input=JSON.parse(request.contents[0].parts[0].text) as {publication:{id:string}[]};
   value={review:input.publication.map(p=>({id:p.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[]};
  }
  const envelope=geminiEnvelope(value);envelope.usageMetadata={promptTokenCount:0,candidatesTokenCount:0,thoughtsTokenCount:0};
  return Response.json(envelope);
 };
}
