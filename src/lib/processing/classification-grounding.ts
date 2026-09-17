import {ProcessingError} from './contracts';
// Explicit entity vocabulary, never a default based on project/source identity.
const axes:Record<string,RegExp>={
 IRAN_DOMESTIC:/(?:\bIran(?:ian)?\b|إيران|إيراني|ايران|ایران)/iu,
 ISRAEL:/(?:\bIsrael(?:i)?\b|إسرائيل|إسرائيلي|اسرائیل)/iu,
 GULF:/(?:\bGulf\b|الخليج|خلیج)/iu,
 WEST:/(?:\b(?:United States|United Kingdom|Europe|European|Western)\b|الولايات المتحدة|بريطانيا|أوروبا|الغرب)/iu,
 GREAT_POWERS:/(?:\b(?:United States|China|Russia)\b|الولايات المتحدة|الصين|روسيا)/iu,
 REGION:/(?:\b(?:Middle East|West Asia)\b|الشرق الأوسط|غرب آسيا)/iu,
};
export function validateTopicGrounding(topic:string,excerpt:string|null,validatedExcerpts:string[]){
 if(excerpt!==null&&!validatedExcerpts.some(e=>e.includes(excerpt)))throw new ProcessingError('CLASSIFICATION_TOPIC_EVIDENCE_INVALID');
 const required=axes[topic];
 if(required&&(!excerpt||!required.test(excerpt)))throw new ProcessingError('CLASSIFICATION_ENTITY_UNSUPPORTED');
}
/** Offer exactly the categories the existing evidence validator can accept. */
export function supportedClassificationTopics<T extends string>(topics:readonly T[],validatedExcerpts:string[]):T[]{
 return topics.filter(topic=>!axes[topic]||validatedExcerpts.some(excerpt=>axes[topic].test(excerpt)));
}
const genericInstitutions:Record<string,string[]>={parliament:['البرلمان','برلمان'],government:['الحكومة','حكومة'],ministry:['الوزارة','وزارة'],committee:['اللجنة','لجنة'],council:['المجلس','مجلس']};
function genericForms(excerpt:string){
 const term=excerpt.trim().toLowerCase().replace(/^the\s+/,'');
 return genericInstitutions[term]??Object.values(genericInstitutions).find(forms=>forms.includes(term));
}
export function validateInstitutionGrounding(excerpt:string,arabic:string,nameKind:string|null){
 const generic=genericForms(excerpt);
 if(generic&&(!generic.includes(arabic)||nameKind!==null))throw new ProcessingError('GENERIC_INSTITUTION_IDENTITY_INFERRED');
}
export function normalizeInstitutionIdentity(excerpt:string,label:{key:string;arabic:string;nameKind:string|null}){
 const generic=genericForms(excerpt);
 if(!generic)return label;
 // Normalize identity metadata only, never repair an invented specific translation.
 if(!generic.includes(label.arabic))throw new ProcessingError('GENERIC_INSTITUTION_IDENTITY_INFERRED');
 const key=Object.entries(genericInstitutions).find(([,forms])=>forms===generic)![0].toUpperCase();
 return {...label,key,nameKind:null};
}
export function validateNoCountryAddition(output:string,sourceExcerpts:string[]){
 for(const matcher of Object.values(axes))if(matcher.test(output)&&!sourceExcerpts.some(e=>matcher.test(e)))throw new ProcessingError('CLASSIFICATION_ENTITY_UNSUPPORTED');
}
/** Narrow evidence-denial grammar, applied only to rationale, never factual prose.
 * Each mention is checked separately so a later positive assertion is not exempt.
 * Unrecognized negation remains conservatively rejected.
 */
export function validateRationaleGrounding(output:string,sourceExcerpts:string[]){
 for(const matcher of Object.values(axes)){
  if(sourceExcerpts.some(e=>matcher.test(e)))continue;
  for(const match of output.matchAll(new RegExp(matcher.source,'giu'))){
   const prefix=output.slice(0,match.index);
   const denial=/(?:لم (?:يثبت|تثبت|يُثبت)|لا (?:يوجد|يتوفر) دليل (?:على|يثبت)|لا تثبت الأدلة|لا يوجد ما يثبت)\s*(?:(?:ارتباط(?:ها|ه)?|وجود|صلة(?:ها|ه)?|انتماء(?:ها|ه)?|هوية)\s*)?(?:(?:ب|بـ)?(?:سياق|جهة|دولة|مؤسسة|هوية|صلة)\s*)?$/u;
   if(!denial.test(prefix))throw new ProcessingError('CLASSIFICATION_ENTITY_UNSUPPORTED');
  }
 }
}
export const classificationGroundingInstructions='Use only immutable validated extraction evidence. Source profile, project name and editorial terminology never establish country or institutional identity. Generic institution terms must remain generic unnamed institutions (nameKind=null), not named national institutions. Never infer country, nationality, affiliation, ownership, role, identity or geopolitical relationships. Any entity-specific topic requires topicEvidence: an exact substring of a validated excerpt explicitly identifying the relevant country/entity. Otherwise use UNKNOWN (existing uncertain-topic review path), never guess. topicEvidence is null when no entity-specific evidence is needed. Do not use an action alone to infer geography. All human-readable rationale must be Arabic and explain only the evidence-supported decision; explicitly acknowledge missing identity/geography without inventing it. Preserve the literal generic meaning of institutions in every translated fact, not only actor labels.';
