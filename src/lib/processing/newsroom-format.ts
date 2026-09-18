import type {Understanding,Draft} from './contracts';
import {ProcessingError} from './contracts';
export const newsroomPrefix='إيران الآن | ';
export function chooseNewsroomFormat(u:Understanding,source:string):Draft['format']{
 const facts=u.event.facts;
 if(/(?:أنباء|تقارير أولية|معلومات متداولة|بحسب تقارير)/u.test(facts.map(f=>f.arabic).join(' ')))return 'UNCERTAIN_REPORT';
 if(/(?:^|\n)\s*(?:فيديو|مشاهد من|بالفيديو|ویدئو|ویدیو|Video\b)/iu.test(source))return 'VISUAL';
 if(facts.length>1&&facts.every(f=>f.speaker&&f.speaker.key===facts[0].speaker?.key))return 'STATEMENT';
 if(facts.length===1&&/[«“"]/u.test(facts[0].arabic)&&facts[0].speaker)return 'QUOTE_LED';
 if(facts.length===1)return 'FLASH';
 if(facts.length>=3)return 'MULTI_POINT_REPORT';
 return 'STANDARD_STORY';
}
export const persianMonths:Record<string,string>={'فروردین':'نيسان','اردیبهشت':'أيار','خرداد':'حزيران','تیر':'تموز','مرداد':'آب','شهریور':'أيلول','مهر':'تشرين الأول','آبان':'تشرين الثاني','آذر':'كانون الأول','دی':'كانون الثاني','بهمن':'شباط','اسفند':'آذار'};
/** Month LABEL convention only. This is not a Solar Hijri -> Gregorian date algorithm. */
export function monthLabelConvention(text:string){
 return text.replace(/(?<![\p{L}\p{N}])(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)(?![\p{L}\p{N}])/gu,(month, _group, offset:number)=>{
  const adjacent=text.slice(Math.max(0,offset-8),offset)+text.slice(offset+month.length,offset+month.length+8);
  // A concrete calendar date cannot be converted by changing just its month name.
  if(/[0-9٠-٩۰-۹]/u.test(adjacent))return month;
  return `${persianMonths[month]} (وفق تسمية الشهر الإيراني)`;
 });
}
export function validateMonthRendering(source:string,arabic:string){
 for(const [month,label] of Object.entries(persianMonths)){
  const escaped=month.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,'gu');
  for(const match of source.matchAll(pattern)){
   if(!arabic.includes(label)||arabic.includes(month))throw new ProcessingError('MATERIAL_DATE_MISMATCH');
   const adjacent=source.slice(Math.max(0,match.index-8),match.index)+source.slice(match.index+month.length,match.index+month.length+8);
   if(/[0-9٠-٩۰-۹]/u.test(adjacent)&&!arabic.includes('بالتقويم الإيراني'))throw new ProcessingError('MATERIAL_DATE_MISMATCH');
  }
 }
}
