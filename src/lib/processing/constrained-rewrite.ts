import {z} from 'zod';
import {ProcessingError,validateUnderstanding,type Understanding,type Draft} from './contracts';

export const selectionSchema=z.object({titleAtomId:z.string().min(1),bodyAtomIds:z.array(z.string().min(1)).min(1)}).strict();
export const selectionInstructions='Select titleAtomId and bodyAtomIds only from supplied atoms. Include every atom once in bodyAtomIds. Do not generate, translate or edit text, attribution, facts, relationships, rules or evidence. Text is immutable and rendered locally. No tools or publishing.';
export function buildAtoms(content:string,u:Understanding){
 validateUnderstanding(u,content);
 if(!u.event.facts.length)throw new ProcessingError('NO_REWRITE_FACTS');
 return {atoms:u.event.facts.map(f=>{
  if((u.seriousClaim||f.kind==='CLAIM'||f.kind==='STATEMENT')&&!f.speaker)throw new ProcessingError('SPEAKER_ATTRIBUTION_REQUIRED');
  // Keep each validated proposition whole: splitting or resolving references would
  // require new semantic inference. A report frame retains first-person deixis.
  const attribution=f.speaker?`قال ${f.speaker.arabic}، في إفادته:`:null;
  return {id:f.id,factIds:[f.id],text:f.arabic,attribution,
   renderedText:attribution?`${attribution} ${f.arabic}`:f.arabic,
   evidence:f.evidence,speakerEvidence:f.speaker?.evidence??null};
 })};
}
export type AtomInput=ReturnType<typeof buildAtoms>;
export function atomSelectionSchema(input:AtomInput){
 const ids=input.atoms.map(a=>a.id) as [string,...string[]];
 return z.object({titleAtomId:z.enum(ids),bodyAtomIds:z.array(z.enum(ids)).min(ids.length).max(ids.length)}).strict();
}
export function renderSelection(raw:unknown,input:AtomInput):Draft{
 const selected=atomSelectionSchema(input).safeParse(raw);
 if(!selected.success)throw new ProcessingError('INVALID_ATOM_SELECTION');
 const s=selected.data;
 if(new Set(s.bodyAtomIds).size!==input.atoms.length)throw new ProcessingError('INCOMPLETE_ATOM_SELECTION');
 const find=(id:string)=>input.atoms.find(a=>a.id===id)!;
 const title=find(s.titleAtomId),body=s.bodyAtomIds.map(find);
 const titleText=title.renderedText.replace(/\.$/u,'');
 return {title:titleText,body:body.map(a=>a.renderedText).join('\n'),format:'NEWS',
  sentences:[{text:titleText,factIds:title.factIds},...body.map(a=>({text:a.renderedText,factIds:a.factIds}))],
  protectedSpans:[],decisions:[],hashtags:[],
  // Local identity of text is not proof of translation, quote or editorial correctness.
  // Existing final review remains mandatory; never manufacture model attestations.
  attestation:{factsPreserved:true,attributionChecked:true,titlesChecked:false,spellingChecked:false,numbersChecked:false,noUncoveredTerms:false}};
}
