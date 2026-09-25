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
 const monthTokens=[...normalized.matchAll(monthPattern)].flatMap(m=>{
  const month=months.get(m[1])!,before=normalized.slice(0,m.index),after=normalized.slice(m.index!+m[0].length);
  const day=before.match(/(?<![0-9])([0-9]{1,2})\s*$/u)?.[1],year=after.match(/^\s+([0-9]{4})(?![0-9])/u)?.[1];
  // Known month synonyms only. Never infer missing components/calendar conversion.
  return [calendar+':month:'+month,...(day?[calendar+':date:'+String(Number(day))+':'+month+':'+(year??'unspecified')]:[])];
 });
 const temporal=normalized.match(/(?<![\p{L}\p{M}])(?:الاثنين|الثلاثاء|الاربعاء|الخميس|الجمعة|السبت|الاحد|غدا|امس|اليوم)(?![\p{L}\p{M}])/gu)??[];
 return [...monthTokens,...temporal];
}
/** Layout normalization with an exact source-position map; lexical text is untouched. */
export function layoutProjection(text:string){
 let value='';const starts:number[]=[],ends:number[]=[];
 for(let i=0;i<text.length;){const start=i;if(/[\s\u200b\u200e\u200f]/u.test(text[i])){while(i<text.length&&/[\s\u200b\u200e\u200f]/u.test(text[i]))i++;value+=' ';starts.push(start);ends.push(i);}else{value+=text[i];starts.push(i);ends.push(++i);}}
 return {value,starts,ends};
}

/** Exact Arabic compound ordinals have a deterministic numeric value. This is
 * a comparison view only, not a quantity/entity/relationship equivalence claim.
 * Restrict to complete definite ordinal constructions, never ordinary nouns. */
export function numericTokens(text:string):string[]{
 const value=orthography(digits(text)).replace(/٫/gu,'.').replace(/(?<=\d)٬(?=\d{3}(?:\D|$))/gu,'');
 const ones:Record<string,number>={'الحادي':1,'الحادية':1,'الثاني':2,'الثانية':2,'الثالث':3,'الثالثة':3,'الرابع':4,'الرابعة':4,'الخامس':5,'الخامسة':5,'السادس':6,'السادسة':6,'السابع':7,'السابعة':7,'الثامن':8,'الثامنة':8,'التاسع':9,'التاسعة':9};
 const tens:Record<string,number>={'العشرون':20,'العشرين':20,'الثلاثون':30,'الثلاثين':30,'الاربعون':40,'الاربعين':40,'الخمسون':50,'الخمسين':50,'الستون':60,'الستين':60,'السبعون':70,'السبعين':70,'الثمانون':80,'الثمانين':80,'التسعون':90,'التسعين':90};
 const pattern=new RegExp('(?<![\\p{L}\\p{N}])('+Object.keys(ones).join('|')+')\\s+و('+Object.keys(tens).join('|')+')(?![\\p{L}\\p{N}])','gu');
 const persianOnes:Record<string,number>={'یک':1,'یکم':1,'یکمین':1,'دو':2,'دوم':2,'دومین':2,'سه':3,'سوم':3,'سومین':3,'چهار':4,'چهارم':4,'پنج':5,'پنجم':5,'شش':6,'ششم':6,'هفت':7,'هفتم':7,'هشت':8,'هشتم':8,'نه':9,'نهم':9};
 const persianTens:Record<string,number>={'بیست':20,'سی':30,'چهل':40,'پنجاه':50,'شصت':60,'هفتاد':70,'هشتاد':80,'نود':90};
 const persianPattern=new RegExp('(?<![\\p{L}\\p{N}])('+Object.keys(persianTens).join('|')+')\\s+و\\s+('+Object.keys(persianOnes).sort((a,b)=>b.length-a.length).join('|')+')(?![\\p{L}\\p{N}])','gu');
 // Parse explicit compound values only; no guessed number/entity relationship.
 return [...(value.match(/[0-9]+(?:[.,][0-9]+)*/gu)??[]).map(n=>/^\d+\.\d+$/u.test(n)?n.replace(/0+$/u,'').replace(/\.$/u,''):n),...[...value.matchAll(pattern)].map(m=>String(ones[m[1]]+tens[m[2]])),...[...digits(text).matchAll(persianPattern)].map(m=>String(persianTens[m[1]]+persianOnes[m[2]]))];
}

/** Exact original regions. A dot inside a digit token is not a sentence break:
 * decimals, dotted dates and grouped numeric values stay indivisible. Other
 * numeric punctuation (Arabic decimal/group separator, colon, slash, hyphen)
 * is not a sentence boundary. Preserve all bytes for repair-integrity checks. */
export function repairTextRegions(text:string):string[]{
 const regions:string[]=[];let start=0;
 for(let i=0;i<text.length;i++){
  const numericDot=text[i]==='.'&&/\p{N}/u.test(text[i-1]??'')&&/\p{N}/u.test(text[i+1]??'');
  if(/[.!؟\n]/u.test(text[i])&&!numericDot){regions.push(text.slice(start,i+1));start=i+1;}
 }
 if(start<text.length)regions.push(text.slice(start));return regions;
}
