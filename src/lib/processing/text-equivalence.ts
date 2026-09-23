/** Comparison views only. Never persist normalized evidence or invented offsets. */
export function orthography(text:string){
 return text.normalize('NFC').replace(/[\u064b-\u065f\u0670\u0640]/gu,'').replace(/ک/gu,'ك').replace(/ی/gu,'ي').replace(/[أإآ]/gu,'ا').replace(/\s+/gu,' ').trim();
}
export function digits(text:string){return text.replace(/[٠-٩۰-۹]/gu,c=>String('٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));}
/** Country modifiers for institutions only, never a person's nationality. This
 * comparison cannot authorize a rewrite: non-literal copy needs independent review. */
export function institutionalIdentity(text:string){
 let value=orthography(text);
 for(const [country,adjective] of [['لبنان','لبناني'],['سوريا','سوري'],['ايران','ايراني'],['العراق','عراقي'],['اليمن','يمني'],['فلسطين','فلسطيني']]){
  const modifier=new RegExp(`(وزارة|بلدية|هيئة|مؤسسة|حكومة|مجلس)([^.،:؛\\n]*?)(?: في ${country}| ال${adjective}ة?)(?=\\s|[.،:؛]|$)`,'gu');
  value=value.replace(modifier,(_all,kind,rest)=>`${kind}${rest} {${country}}`);
 }
 return value;
}
const monthGroups=[['يناير','كانون الثاني'],['فبراير','شباط'],['مارس','آذار','اذار'],['أبريل','ابريل','نيسان'],['مايو','أيار','ايار'],['يونيو','حزيران'],['يوليو','تموز'],['أغسطس','اغسطس','آب','اب'],['سبتمبر','أيلول','ايلول'],['أكتوبر','اكتوبر','تشرين الأول','تشرين الاول'],['نوفمبر','تشرين الثاني'],['ديسمبر','كانون الأول','كانون الاول']];
const months=new Map(monthGroups.flatMap((names,i)=>names.map(name=>[orthography(name),String(i+1).padStart(2,'0')] as const)));
const monthPattern=new RegExp('(?<![\\p{L}])('+[...months.keys()].sort((a,b)=>b.length-a.length).join('|')+')(?![\\p{L}])','gu');
/** Calendar qualifier is part of identity: month synonyms are NOT calendar conversion. */
export function dateTokens(text:string){
 const normalized=orthography(digits(text));
 const calendar=/بالتقويم (?:الايراني|الفارسي)|هجري شمسي/u.test(normalized)?'solar-hijri':/هجري/u.test(normalized)?'hijri':'source-calendar';
 const monthTokens=[...normalized.matchAll(monthPattern)].map(m=>`${calendar}:month:${months.get(m[1])}`);
 const temporal=normalized.match(/(?<![\p{L}\p{M}])(?:الاثنين|الثلاثاء|الاربعاء|الخميس|الجمعة|السبت|الاحد|غدا|امس|اليوم)(?![\p{L}\p{M}])/gu)??[];
 return [...monthTokens,...temporal];
}
/** Layout normalization with an exact source-position map; lexical text is untouched. */
export function layoutProjection(text:string){
 let value='';const starts:number[]=[],ends:number[]=[];
 for(let i=0;i<text.length;){const start=i;if(/[\s\u200b\u200e\u200f]/u.test(text[i])){while(i<text.length&&/[\s\u200b\u200e\u200f]/u.test(text[i]))i++;value+=' ';starts.push(start);ends.push(i);}else{value+=text[i];starts.push(i);ends.push(++i);}}
 return {value,starts,ends};
}
