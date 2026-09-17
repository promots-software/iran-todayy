/** Conservative local heuristics; detection never changes the original evidence. */
type Sample={text:string;words:string[]};
const detectors = [
 {language:'fa',matches:({text,words}:Sample)=>words.filter(w=>/^(که|از|را|در|به|شده|کرده‌اند|بودند|گفته|نیست|است)$/.test(w)).length>=2 && /[پچژگکی\u200c]/u.test(text)},
 {language:'ar',matches:({text,words}:Sample)=>!/[پچژگکی]/u.test(text) && words.filter(w=>/^(في|من|إلى|على|أن|إن|قال|التي|الذي)$/.test(w)).length>=2},
 {language:'en',matches:({text,words}:Sample)=>{
  if(!/^[\x00-\x7f\u2018\u2019\u201c\u201d\u2013\u2014…]*$/u.test(text)||words.length<4)return false;
  const markers=new Set(['the','and','of','to','in','is','are','was','were','has','have','had','that','this','with','from','for','not','will','would','their','they','it','its','on','by','said']);
  const hits=words.map(w=>w.toLowerCase()).filter(w=>markers.has(w));
  return new Set(hits).size>=2 && hits.length/words.length>=0.2;
 }},
] as const;
export type SourceLanguage=typeof detectors[number]['language']|'unknown';
export function sourceLanguage(original:string):SourceLanguage{
 // Links and handles do not establish the language of the prose. Working copy only.
 const text=original.replace(/https?:\/\/\S+|\b[\w.-]+\.(?:com|org|net|ir)\/\S*|@[\p{L}\p{N}_]+/gu,' ');
 const latin=(text.match(/\p{Script=Latin}/gu)??[]).length;
 const arabic=(text.match(/\p{Script=Arabic}/gu)??[]).length;
 if(latin>0&&arabic>0)return 'unknown';
 const sample={text,words:text.match(/[\p{L}\u200c]+/gu)??[]};
 const matches=detectors.filter(d=>d.matches(sample));
 return matches.length===1?matches[0].language:'unknown';
}
