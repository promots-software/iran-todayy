/** Local language evidence only. Normalization is private; stored evidence is never changed. */
export type SourceLanguage='fa'|'ar'|'en'|'unknown';
const englishGrammar=new Set(['the','and','of','to','in','is','are','was','were','has','have','had','that','this','with','from','for','not','will','would','their','they','it','its','on','by','said']);
const faGrammar=new Set(['که','از','را','در','به','با','بر','برای','تا','شد','شده','کرد','کرده','بود','بودند','گفته','نیست','است','هست','هستند','شود','شوند','خواهد','خواهند','این','آن','او','هم','چه','یک']);
const arGrammar=new Set(['في','من','إلى','على','أن','إن','قال','التي','الذي','هذا','هذه','لم','لن','ليس','بعد','بين','خلال','أمام','نحو','عن','عند']);
// Frequent native Persian vocabulary complements shared Arabic loanwords. No names,
// source handles or topic labels are language evidence.
const faLexicon=new Set(['امروز','دیروز','فردا','مردم','مردمی','بیش','کمتر','بیشتر','شب','روز','کشور','شهر','شهرستان','خانه','خانواده','کار','کارگران','گزارش','درباره','همچنان','رایگان','پیش','پس','دیگر','نخست','تازه','اکنون','هنوز','چند','چرا','کدام','خود']);
function scriptLanguage(text:string):'ar'|'fa'|'unknown'{
 const rawWords=text.replace(/[\u064b-\u065f\u0670\u0640]/gu,'').match(/[\p{L}\u200c]+/gu)?.filter(w=>/\p{Script=Arabic}/u.test(w))??[];
 const words=rawWords.map(w=>w.replace(/ی/g,'ي').replace(/ک/g,'ك'));
 const faWords=words.map(w=>w.replace(/ي/g,'ی').replace(/ك/g,'ک'));
 if(words.length<4)return 'unknown';
 // Distinct words, not repeated marker spam; each token contributes at most one
 // point per language. Definite articles include productive Arabic clitics.
 const ar=new Set<string>(), fa=new Set<string>();
 let arMorph=0, faMorph=0, faLexical=0, nisbaCount=0;
 const nisbaSupported=words.some(t=>/ة$/u.test(t))||(words.some(t=>/^(?:[وف])?ال/u.test(t))&&faWords.filter(w=>faGrammar.has(w)).length<2);
 for(let i=0;i<words.length;i++){
  const w=words[i], f=faWords[i];
  const article=/^(?:[وف])?(?:[بك]?ال|لل)[\p{L}]{2,}$/u.test(w);
  const feminine=/[\p{L}]{2}ة$/u.test(w);
  const nisba=/[\p{L}]{3}ي(?:ة|ون|ين)?$/u.test(w);
  if(arGrammar.has(w)||article||feminine){ar.add(w);if(article||feminine)arMorph++;}
  // Nisba alone is shared with Persian; use it only alongside Arabic feminine
  // or definite constructions, evaluated below.
  if(nisba&&nisbaCount<2&&nisbaSupported){ar.add(w);nisbaCount++;}
  const morphology=/^(?:ن?می)\u200c[\p{L}]+$/u.test(f)||/^[\p{L}]+\u200c(?:ها|های|هایی|تر|ترین|اند|ای)$/u.test(f)||(/^[\p{L}]{3,}(?:های|هایی)$/u.test(f)&&faWords.some(t=>['در','از','را','که','این','آن','است','هستند','نیست'].includes(t)));
  if(faGrammar.has(f)||faLexicon.has(f)||morphology){fa.add(f);if(morphology)faMorph++;if(faLexicon.has(f))faLexical++;}
 }
 // Orthography can corroborate grammar, never independently identify Persian.
 const persianOrthography=/[پچژگکی\u200c۰-۹]/u.test(text);
 const arReady=ar.size>=2&&(arMorph>=1||ar.size>=3||words.some(w=>arGrammar.has(w)));
 const faReady=fa.size>=2||(fa.size>=1&&persianOrthography&&(faMorph>0||faLexical>0||rawWords.filter(w=>/[پچژگکی]/u.test(w)).length>=2));
 // Arabic evidence needs a larger margin because Persian borrows Arabic words
 // and definite constructions. Native Persian grammar can outweigh those loans;
 // a separately recognizable Arabic passage still vetoes at the document level.
 if(arReady&&faReady){
  // Arabic loans and institution names are not Arabic prose. Distinct Persian
  // function words corroborated by Persian orthography outweigh noun-only
  // article/nisba scores, but not an independently grammatical Arabic passage.
  const nativeArabic=words.filter(w=>arGrammar.has(w)&&!['من','بين'].includes(w));
  const persianFunctions=new Set(faWords.filter(w=>faGrammar.has(w)));
  if(persianOrthography&&persianFunctions.size>=2&&nativeArabic.length===0)return 'fa';
  if(persianOrthography&&faWords.some(w=>['هستند','نیست','بودند'].includes(w))&&nativeArabic.length===0)return 'fa';
  if(ar.size>=fa.size*3&&faMorph===0)return 'ar';
  if(fa.size>=ar.size*2)return 'fa';
  return 'unknown';
 }
 if(arReady)return 'ar';
 if(faReady)return 'fa';
 return 'unknown';
}
export function sourceLanguage(original:string):SourceLanguage{
 const text=original.replace(/https?:\/\/\S+|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|\b[\w.-]+\.(?:com|org|net|ir|me)(?:\/\S*)?|@[\p{L}\p{N}_]+/gu,' ');
 const latin=text.match(/[A-Za-z]+/g)??[];
 const arabic=(text.match(/\p{Script=Arabic}/gu)??[]).length;
 if(latin.length&&arabic){
  // Permit a small label/acronym island, but never English grammatical prose.
  const grammar=latin.some(w=>englishGrammar.has(w.toLowerCase()));
  const latinLength=latin.join('').length;
  // Dispersed uppercase equipment/acronym labels are not English prose.
  // Retain the density and grammar vetoes, and reject contiguous Latin phrases.
  const scatteredAcronyms=latin.every(w=>/^[A-Z]{1,5}$/.test(w))&&!/[A-Za-z]+(?:[\s-]+[A-Za-z]+){2}/.test(text);
  if(grammar||(new Set(latin).size>4&&!scatteredAcronyms)||latinLength>arabic*0.3)return 'unknown';
  const labels=latin.every(w=>/^[A-Z][A-Za-z]*$/.test(w))||/\([A-Z][a-z]+ [a-z]+\)/.test(text)&&latin.length===2||latin.every(w=>/^[A-Za-z]$/.test(w));
  if(!labels)return 'unknown';
 }
 if(arabic){
  const segments=text.split(/[\n.!؟]+/u).filter(t=>(t.match(/[\p{L}\u200c]+/gu)??[]).length>=5);
  const languages=new Set(segments.map(scriptLanguage).filter(l=>l!=='unknown'));
  if(languages.size>1)return 'unknown';
  return scriptLanguage(text);
 }
 if(!/^[\x00-\x7f\u2018\u2019\u201c\u201d\u2013\u2014…]*$/u.test(text)||latin.length<4)return 'unknown';
 const hits=latin.map(w=>w.toLowerCase()).filter(w=>englishGrammar.has(w));
 return new Set(hits).size>=2&&hits.length/latin.length>=0.2?'en':'unknown';
}

/** Detailed content-only diagnosis; existing extraction contracts deliberately
 * receive unknown for mixed prose until a mixed-language contract is reviewed. */
export function detectSourceLanguage(original:string):SourceLanguage|'mixed'{
 const classified=sourceLanguage(original);if(classified!=='unknown')return classified;
 const parts=original.replace(/https?:\/\/\S+|@[\p{L}\p{N}_]+/gu,' ').split(/[\n.!؟]+/u);
 const confident=new Set(parts.map(sourceLanguage).filter(l=>l!=='unknown'));
 return confident.size>1?'mixed':'unknown';
}
