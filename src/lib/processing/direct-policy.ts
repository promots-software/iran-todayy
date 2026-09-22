import type {Understanding} from './contracts';
/** Selection policy is decided by source administration; factual validity is not. */
export function editoriallyFiltered(u:Understanding,approvedAnalyst:boolean,mode:'NORMAL'|'DIRECT'){
 if(mode==='DIRECT')return false;
 void approvedAnalyst;
 return u.relevance==='IRRELEVANT';
}
export function selectionBlocksDraft(u:Understanding,mode:'NORMAL'|'DIRECT'){
 return mode==='NORMAL'&&u.relevance==='IRRELEVANT';
}
