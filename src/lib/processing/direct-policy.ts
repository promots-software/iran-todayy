import type {Understanding} from './contracts';
/** Both modes require a source-grounded Iran relevance decision. */
export function editoriallyFiltered(u:Understanding,approvedAnalyst:boolean,mode:'NORMAL'|'DIRECT'){
 void approvedAnalyst;void mode;
 return u.relevance==='IRRELEVANT';
}
export function selectionBlocksDraft(u:Understanding,mode:'NORMAL'|'DIRECT'){
 void mode;return u.relevance==='IRRELEVANT';
}
