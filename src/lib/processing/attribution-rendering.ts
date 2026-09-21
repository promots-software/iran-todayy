const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Grammar of an explicit Arabic institutional head, not inferred personal gender. */
export function attributionLead(speaker:string){
 const feminine=/^(?:ال)?(?:وزارة|هيئة|بلدية|وكالة|إدارة|لجنة|شركة|جامعة|مؤسسة|سلطة|حكومة|رئاسة|مديرية)(?:\s|$)/u.test(speaker);
 return `${feminine?'قالت':'قال'} ${speaker}:`;
}
/** Preserve already-reviewed wording; never add a source medium or a new claim. */
export function hasExplicitArabicAttribution(text:string,speaker:string){
 const name=escape(speaker),verb='(?:قالت?|أعلنت?|أوضحت?|أضافت?|أكدت?|ذكرت?|صرحت?)';
 return new RegExp(`^(?:[وف])?${verb}\\s+${name}(?:[\\s،:：]|$)|^${name}\\s*(?:[:：]|${verb}(?:[\\s،:：]|$))`,'u').test(text.trim());
}
