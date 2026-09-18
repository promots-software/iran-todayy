import type {Understanding} from '../../src/lib/processing/contracts';
import {validateRendering} from '../../src/lib/processing/evidence-rendering';
import {renderingChecks} from '../../src/lib/processing/rendering-contract';
import {classificationReferences,adaptIdClassification} from '../../src/lib/processing/id-classification';
import type {GroundedExtraction} from '../../src/lib/processing/groq-extraction';

/** Synthetic structures; no live identities, external facts or provider calls. */
export function newsroom(source:string,statements:string[],speaker?:string):Understanding{
 const ev=(excerpt:string)=>({excerpt,start:source.indexOf(excerpt),end:source.indexOf(excerpt)+excerpt.length});
 const support=(excerpt:string)=>({key:excerpt,arabic:excerpt,evidence:ev(excerpt)});
 return {language:'ar',relevance:'POLITICAL_NEWS',filterReason:'NONE',topic:'UNKNOWN',priority:'P2',rationale:'خبر سياسي تدعمه أدلة المصدر',
  names:[],uncoveredTerms:[],sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,
  event:{actors:[support(speaker??statements[0])],action:support(statements[0]),object:null,location:null,eventTime:null,summary:null,
   facts:statements.map((s,i)=>({id:`f${i+1}`,key:s,arabic:s,evidence:ev(s),kind:speaker?'STATEMENT':'FACT',material:true,verified:false,speaker:speaker?support(speaker):null}))}};
}
export const cleanCases=()=>{
 const flash='أعلن البرلمان في بيان أن الجلسة ستعقد في موعدها.';
 const a='أكدت الوزارة في بيان أن الوفد وصل إلى العاصمة.';
 const b='وأوضحت الوزارة أن الاجتماع سيعقد في مقرها.';
 const c='وأشارت الوزارة إلى أن جدول الأعمال يتضمن التعاون.';
 const heading='المتحدث باسم الوزارة';
 const headingSource=heading+':\n- '+a+'\n- '+b;
 const seriousText='قال المتحدث إن القوات اعترضت صاروخا في المنطقة.';
 const serious=newsroom(seriousText,['إن القوات اعترضت صاروخا في المنطقة.'],'المتحدث');serious.seriousClaim=true;serious.event.facts[0].kind='CLAIM';
 const unknown=newsroom('قال سالم منصور إن الوفد وصل إلى العاصمة.',['إن الوفد وصل إلى العاصمة.'],'سالم منصور');unknown.names=[{arabic:'سالم منصور',kind:'person',evidence:unknown.event.facts[0].speaker!.evidence}];
 const rank=newsroom('قال نائب رئيس المجلس إن الاجتماع سيعقد في المقر.',['إن الاجتماع سيعقد في المقر.'],'نائب رئيس المجلس');rank.rankUnverified=true;
 const numbered='أعلنت الوزارة في بيان أن المجلس وافق على 25 مقترحا.';
 const uncertain='أنباء عن اجتماع للوفد في العاصمة بحسب تقارير أولية من مصادر محلية.';
 const quote=newsroom('قال المتحدث: «إن الاجتماع في موعده».',['«إن الاجتماع في موعده».'],'المتحدث');
 const visual='فيديو\nمشاهد من وصول الوفد إلى المقر في العاصمة.';
 return [
  {name:'Arabic flash',source:flash,u:newsroom(flash,[flash])},
  persianCase(),
  {name:'Speaker heading and bullets',source:headingSource,u:newsroom(headingSource,[a,b],heading)},
  {name:'Attributed serious claim',source:seriousText,u:serious},
  {name:'Clear unseen name',source:'قال سالم منصور إن الوفد وصل إلى العاصمة.',u:unknown},
  {name:'Sourced rank',source:'قال نائب رئيس المجلس إن الاجتماع سيعقد في المقر.',u:rank},
  {name:'Preserved numbers',source:numbered,u:newsroom(numbered,[numbered])},
  {name:'Preserved uncertainty',source:uncertain,u:newsroom(uncertain,[uncertain])},
  {name:'Literal quote',source:'قال المتحدث: «إن الاجتماع في موعده».',u:quote},
  {name:'Standard story',source:a+'\n'+b,u:newsroom(a+'\n'+b,[a,b])},
  {name:'Multi-point report',source:a+'\n'+b+'\n'+c,u:newsroom(a+'\n'+b+'\n'+c,[a,b,c])},
  {name:'Visual caption',source:visual,u:newsroom(visual,[visual.split('\n')[1]])},
 ];
};
function persianCase(){
 const source='وزارت اعلام کرد که هیئت به تهران رسیده است.';
 const ev=(excerpt:string)=>({excerpt,start:source.indexOf(excerpt),end:source.indexOf(excerpt)+excerpt.length});
 const x:GroundedExtraction={relevance:'POLITICAL_NEWS',actors:[ev('وزارت')],action:ev('اعلام کرد'),object:null,location:ev('تهران'),event_time:null,statements:[{id:'f1',evidence:ev(source),speaker:null}]};
 const refs=classificationReferences(x).entries;
 const arabic:Record<string,string>={'actor:1':'الوزارة',action:'أعلنت',location:'طهران',f1:'أعلنت الوزارة أن الوفد وصل إلى طهران.'};
 const receipt=validateRendering(source,refs,{entries:refs.map(r=>({id:r.id,arabic:arabic[r.id]}))},{review:refs.map(r=>({id:r.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]}))});
 const u=adaptIdClassification(x,{anchorIds:['actor:1','action','location'],factLabels:[{id:'f1',kind:'FACT',material:true}],filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:['f1']},source,receipt);
 return {name:'Persian with validated rendering',source,u};
}
