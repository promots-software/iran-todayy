import type {GoldCase} from './schema';
import {publicationUnits} from '../../../src/lib/processing/direct-publication';
import {reviewedFixture} from '../../fixtures/current-direct';
import {geminiEnvelope} from '../../fixtures/direct-bilingual';
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
 const legacy=replayExtraction(c);
 return async(_url,init)=>{
  const request=JSON.parse(String(init?.body)),properties=request.generationConfig.responseJsonSchema.properties,data=JSON.parse(request.contents[0].parts[0].text);
  let value:unknown;
  if(properties.extraction){
   const clean=JSON.parse(JSON.stringify(legacy,(key,value)=>key==='arabic'||key==='publication'||key==='coverage'?undefined:value));
   const proposal=c.replay.publication as {title:{text:string};body:{text:string}[]}|null;
   value={extraction:{...clean,relevance:'POLITICAL_NEWS',contentType:'NEWS',contentTypeEvidence:{excerpt:c.sourceText,context:c.sourceText},coverage:publicationUnits(c.sourceText).map(unit=>({unitId:unit.id,nonFactual:unit.kind==='DISTRIBUTION',factIds:c.materialFacts.filter(f=>unit.text.includes(f.sourceExcerpt)).map(f=>f.id)}))},article:{title:'إيران الآن | '+(proposal?.title.text??c.replay.arabicFacts[0]).replace(/^إيران الآن \| /u,'').replace(/\.$/u,''),body:proposal?proposal.body.map(p=>p.text).join('\n'):c.materialFacts.length>1?c.replay.arabicFacts.join('\n'):'',diagnostics:[]}};
  }else if(properties.comparisons){
   const review=reviewedFixture(c.sourceText,data.publication);
   value={...review,comparisons:data.comparisons.map((entry:{id:string;existing:{facts:{id:string}[]}})=>({id:entry.id,decision:{...(c.replay.comparison??{relation:'SAME',newFactIds:[],conflictingFactIds:[],rationale:'نفس الحقائق المثبتة'}),identity:{basis:'SAME_OCCURRENCE',incomingFactIds:data.incoming.facts.map((f:{id:string})=>f.id),existingFactIds:entry.existing.facts.map(f=>f.id),explanation:'Explicit authored offline event identity verdict.'}}}))};
  }else if(properties.relation){
   // Retained pure matcher utility tests use a standalone comparison receipt.
   value={...(c.replay.comparison??{relation:'SAME',newFactIds:[],conflictingFactIds:[],rationale:'نفس الحقائق المثبتة'}),identity:{basis:'SAME_OCCURRENCE',incomingFactIds:data.incoming.facts.map((f:{id:string})=>f.id),existingFactIds:data.existing.facts.map((f:{id:string})=>f.id),explanation:'Explicit offline legacy matcher verdict'}};
  }else throw Error('UNHANDLED_OFFLINE_STAGE');
  const envelope=geminiEnvelope(value);envelope.usageMetadata={promptTokenCount:0,candidatesTokenCount:0,thoughtsTokenCount:0};
  return Response.json(envelope);
 };
}
