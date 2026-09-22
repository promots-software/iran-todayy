const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** A reporting frame, not a substituted speech act. Never infer announced,
 * confirmed, denied or warned from a speaker's grammatical number. */
export function collectiveAttribution(speaker:string){
 const head=speaker.normalize('NFC').replace(/[\u064b-\u065f\u0670]/gu,'').trim();
 return /^(?:ال)?(?:مصادر|دول|بلدان|جهات|أطراف|مؤسسات|وزارات|هيئات|حكومات|منظمات|قادة|رؤساء|وزراء|مسؤولون|مسؤولين|متحدثون|متحدثين)(?:\s|$)/u.test(head)||/^(?:ال)?بيان\s+(?:ال)?مشترك(?:\s|$)/u.test(head)||/\sو(?=\p{L})/u.test(head);
}
/** Grammar of an explicit Arabic institutional head, not inferred personal gender. */
export function attributionLead(speaker:string){
 if(collectiveAttribution(speaker))return `بحسب ${speaker}:`;
 const feminine=/^(?:ال)?(?:وزارة|هيئة|بلدية|وكالة|إدارة|لجنة|شركة|جامعة|مؤسسة|سلطة|حكومة|رئاسة|مديرية)(?:\s|$)/u.test(speaker);
 return `${feminine?'قالت':'قال'} ${speaker}:`;
}
export function normalizeAttributionAgreement(text:string,speaker:string){
 const lead=attributionLead(speaker);
 // Repair only the generic locally supplied said-frame; retain every more
 // specific source verb, negation and modal exactly as supplied.
 return text.replace(new RegExp(`^(إيران الآن\\s*\\|\\s*)?(?:قال|قالت)\\s+${escape(speaker)}\\s*[:：]`,'u'),(_all,brand)=>`${brand??''}${lead}`);
}
/** Preserve already-reviewed wording; never add a source medium or a new claim. */
export function hasExplicitArabicAttribution(text:string,speaker:string){
 const name=escape(speaker),verb='(?:قالت?|أعلنت?|أوضحت?|أضافت?|أكدت?|ذكرت?|صرحت?)';
 return new RegExp(`^(?:[وف])?${verb}\\s+${name}(?:[\\s،:：]|$)|^(?:بحسب|حسب)\\s+${name}(?:[\\s،:：]|$)|^${name}\\s*(?:[:：]|${verb}(?:[\\s،:：]|$))`,'u').test(text.trim());
}
