import type {Understanding} from './contracts';
/** Selection policy is decided by source administration; factual validity is not. */
export function editoriallyFiltered(u:Understanding,approvedAnalyst:boolean,mode:'NORMAL'|'DIRECT'){
 if(mode==='DIRECT')return false;
 return u.relevance==='IRRELEVANT'||['UNRELATED','ADVERTISING','SATIRE','RUMOUR','INCITEMENT'].includes(u.filterReason)||(u.filterReason==='OPINION'&&!approvedAnalyst);
}
export function selectionBlocksDraft(u:Understanding,mode:'NORMAL'|'DIRECT'){
 return mode==='NORMAL'&&(u.relevance!=='POLITICAL_NEWS'||u.priority==='P4');
}
