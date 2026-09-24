import {isGroundedTerminologyQuote} from './editorial-contract';
import {orthography} from './text-equivalence';

const quotePattern=/«[^»]*»|“[^”]*”|"[^"\n]*"/gu;
const inner=(q:string)=>q.slice(1,-1).replace(/\s+/gu,' ').trim();
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const containsName=(source:string,name:string)=>new RegExp('(?<![\\p{L}\\p{N}])'+escape(orthography(name))+'(?![\\p{L}\\p{N}])','u').test(orthography(source));
/** Spelling an explicitly supplied Latin initialism is typography, not an
 * inferred organization alias. Do not expand acronyms into organization names. */
function initialism(name:string,evidence:string){
 const names=['ايه','بي','سي','دي','اي','اف','جي','اتش','اي','جاي','كاي','ال','ام','ان','او','بي','كيو','ار','اس','تي','يو','في','دبليو','اكس','واي','زد'];
 const candidate=orthography(name).replace(/\s+/gu,'');
 return [...evidence.matchAll(/(?<![A-Za-z0-9])[A-Z]{2,6}(?![A-Za-z0-9])/gu)].some(m=>[...m[0]].map(c=>names[c.charCodeAt(0)-65]).join('')===candidate);
}
/** Delimiters are typography; the words of actual direct speech stay literal. */
export function unsupportedQuotes(output:string,evidence:string):string[]{
 const sourceQuotes=[...evidence.matchAll(quotePattern)].map(m=>inner(m[0]));
 return [...output.matchAll(quotePattern)].filter(m=>{
   const q=m[0],value=inner(q);
   if(sourceQuotes.includes(value)||isGroundedTerminologyQuote('"'+value+'"',evidence))return false;
   // A named entity in an explicit entity position is not a quotation of speech.
   // Require the same name in the validated evidence; no inferred aliases.
   const before=output.slice(Math.max(0,m.index-40),m.index);
   const entityPosition=/(?:شبكة|صحيفة|وكالة|قناة|شركة|مؤسسة|منظمة|جامعة|مجلة)\s*$/u.test(before);
   if(entityPosition&&value&&!/[.!؟،؛:]/u.test(value)&&(containsName(evidence,value)||initialism(value,evidence)))return false;
   return true;
 }).map(m=>m[0]);
}
