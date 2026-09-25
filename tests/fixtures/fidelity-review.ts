import {sourceUnits} from '../../src/lib/processing/source-units';
import type {PublicationUnit} from '../../src/lib/processing/fidelity-ledger';
/** Explicit mock semantic verdict, NOT a language evaluator. */
export function supportedLedger(source:string,publication:PublicationUnit[]){
 const units=sourceUnits(source),content=units.filter(u=>u.kind==='CONTENT');
 return {
  claims:publication.map(p=>({components:[{id:p.id+':component',excerpt:p.text,sourceUnitIds:content.map(u=>u.id),verdict:'SUPPORTED' as 'SUPPORTED'|'UNSUPPORTED'|'UNCERTAIN',explanation:'Explicit offline semantic component.'}],publicationId:p.id,excerpt:p.text,sourceUnitIds:content.map(u=>u.id),verdict:'SUPPORTED' as const,explanation:'Explicit offline fixture verdict; source meaning is supported.'})),
  sourceCoverage:units.map(u=>({unitId:u.id,publicationIds:u.kind==='CONTENT'?publication.map(p=>p.id):[],temporal:u.kind==='CONTENT'?publication.map(p=>({publicationId:p.id,sourceExcerpt:u.text,sourceState:{time:'UNSPECIFIED' as const,phase:'UNSPECIFIED' as const,continuity:'UNSPECIFIED' as const,certainty:'ASSERTED' as const},candidateExcerpt:p.text,candidateState:{time:'UNSPECIFIED' as const,phase:'UNSPECIFIED' as const,continuity:'UNSPECIFIED' as const,certainty:'ASSERTED' as const},assessment:'PRESERVED' as const,explanation:'Explicit offline semantic fixture; not inferred by helper.'})):[],disposition:u.kind==='CONTENT'?'PRESERVED' as const:'NON_MATERIAL_PRESENTATION' as const,explanation:'Explicit offline fixture coverage.'})),
 };
}

/** Explicit migration for OFFLINE fixtures only; never upgrades runtime receipts. */
export function componentFixture<T extends {claims:{publicationId:string;excerpt:string;sourceUnitIds:string[];verdict:string;explanation:string}[]}>(ledger:T){
 return {...structuredClone(ledger),claims:ledger.claims.map((c,i)=>({...structuredClone(c),components:[{id:'fixture:'+i,excerpt:c.excerpt,sourceUnitIds:[...c.sourceUnitIds],verdict:c.verdict as 'SUPPORTED'|'UNSUPPORTED'|'UNCERTAIN',explanation:c.explanation}]}))};
}
