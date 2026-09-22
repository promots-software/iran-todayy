import {editorialScope} from './editorial-scope';
import type {Understanding} from './contracts';
/** Narrow source-proven impersonal sound report. Never manufactures an actor.
 * All substantive source text must be the one verbatim assertion. Unknown
 * agents, omitted clauses, attributed speech and other constructions stay closed.
 */
export function completeImpersonalReport(source:string|undefined,x:{actors:unknown[];action:{excerpt:string}|null;location:{excerpt:string}|null;statements:{evidence:{excerpt:string};speaker:unknown}[]}){
 if(!source||x.actors.length||!x.action||!x.location||x.statements.length!==1||x.statements[0].speaker)return false;
 const normalize=(s:string)=>s.normalize('NFC').replace(/[\u064b-\u065f\u0670]/gu,'').trim().replace(/[.。]$/u,'').replace(/\s+/gu,' ');
 const action=normalize(x.action.excerpt),location=normalize(x.location.excerpt),fact=normalize(x.statements[0].evidence.excerpt);
 if(!/^(?:سماع|سمع|سمعت) (?:دوي|أصوات) (?:انفجار|انفجارات|إطلاق نار|رعد)$/u.test(action))return false;
 if(fact!==`${action} ${location}`)return false;
 const place=location.replace(/^(?:شمال|جنوب|شرق|غرب|وسط|في|قرب|محيط)\s+(?:(?:مدينة|بلدة|منطقة|مخيم|محافظة)\s+)?/u,'');
 if(place===location||!editorialScope(location).evidence.some(name=>normalize(name)===place))return false;
 const lines=source.split('\n').map(s=>s.replace(/^[\s\p{Extended_Pictographic}\uFE0F]+/gu,'').trim()).filter(s=>s&&!/^عاجل[|:：]?$/u.test(s)&&!/^@[A-Za-z0-9_]+$/u.test(s));
 return lines.length===1&&normalize(lines[0])===fact;
}
export function completeEventStructure(u:Understanding,source:string,mode:'NORMAL'|'DIRECT'){
 const x={actors:u.event.actors,action:u.event.action?.evidence??null,location:u.event.location?.evidence??null,statements:u.event.facts.map(f=>({evidence:f.evidence,speaker:f.speaker}))};
 return !!u.event.action&&u.event.facts.length>0&&(u.event.actors.length>0||completeObservedEvent(source,x)||(mode==='NORMAL'&&completeImpersonalReport(source,x)));
}

/** An intransitive event need not have an agent. Require the entire assertion,
 * not merely a model claim of completeness. Speech and multi-claim text remain
 * outside this proof; downstream material coverage and semantic review still run. */
export function completeObservedEvent(source:string|undefined,x:Parameters<typeof completeImpersonalReport>[1]){
 if(!source||x.actors.length||!x.action||!x.location||x.statements.length!==1||x.statements[0].speaker)return false;
 const trim=(s:string)=>s.trim().replace(/[.。]$/u,'').replace(/\s+/gu,' ');
 const prose=source.split('\n').filter(s=>!/^\s*(?:@[\w]+|https?:\/\/\S+)\s*$/u.test(s)).join('\n');
 const fact=trim(x.statements[0].evidence.excerpt),action=trim(x.action.excerpt);
 return trim(prose)===fact&&fact.includes(x.location.excerpt)&&fact.startsWith(action+' ')&&/^(?:وقع|وقعت|حدث|حدثت|اندلع|اندلعت|هطل|هطلت|سُجل|سُجلت)(?:\s|$)/u.test(action);
}
