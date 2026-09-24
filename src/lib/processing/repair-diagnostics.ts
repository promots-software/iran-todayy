import {validateObjectiveArticle} from './direct-publication';
import {numericTokens,dateTokens} from './text-equivalence';
import {unsupportedQuotes} from './quote-integrity';
import {sourceLanguage} from './source-language';
import {ProcessingError,type Understanding} from './contracts';
import {atPath,type RepairDiagnostic,type RepairPath} from './targeted-repair';
import {fidelityLedgerSchema} from './fidelity-ledger';
import {sourceUnits} from './source-units';

/** Repair semantic defects only after an independent review identifies them;
 * absent/ambiguous source evidence cannot be repaired by generated prose. */
export function fidelityRepairDiagnostics(raw:unknown,source:string,u:Understanding,candidate:unknown,direct=false){
 const parsed=fidelityLedgerSchema.safeParse(raw);if(!parsed.success)return [];
 // A repairable clause cannot authorize rewriting around unresolved evidence.
 if(parsed.data.claims.some(c=>c.verdict==='UNCERTAIN')||parsed.data.sourceCoverage.some(c=>c.disposition==='UNCERTAIN'||c.temporal.some(t=>t.assessment==='UNCERTAIN')))return [];
 const units=sourceUnits(source),ds:RepairDiagnostic[]=[];
 const add=(id:string,unitIds:string[],cause:string,code:string)=>{
  const linked=units.filter(unit=>unitIds.includes(unit.id));
  const ids=u.event.facts.filter(f=>linked.some(unit=>f.evidence.start<unit.end&&f.evidence.end>unit.start)).map(f=>f.id);
  const path:RepairPath=direct?['article',id==='title'?'title':'body']:id==='title'?['publication','title','text']:['publication','body',Number(id.split(':')[1])-1,'text'];
  if(typeof atPath(candidate,path)!=='string')return;
  const d=groundedRepairDiagnostic(code,path,candidate,u,ids,cause,source);if(d&&!ds.some(existing=>existing.code===d.code&&JSON.stringify(existing.path)===JSON.stringify(d.path)))ds.push(d);
 };
 for(const claim of parsed.data.claims)if(claim.verdict==='UNSUPPORTED')add(claim.publicationId,claim.sourceUnitIds,claim.explanation,'UNSUPPORTED_ASSERTION');
 for(const row of parsed.data.sourceCoverage)for(const t of row.temporal)if(t.assessment==='CHANGED'||(['time','phase','continuity','certainty'] as const).some(k=>t.sourceState[k]!==t.candidateState[k]))add(t.publicationId,[row.unitId],t.explanation,'UNSUPPORTED_ASSERTION');
 // Missing source material requires a real already-extracted supporting fact.
 for(const row of parsed.data.sourceCoverage)if(row.disposition==='MISSING')add(direct?'body:1':'body:1',[row.unitId],row.explanation,'MISSING_SUPPORTED_FACT');
 return ds;
}
/** Construct a mutation scope only for a concrete publication region tied to
 * validated exact source evidence. A review verdict alone is not a diagnosis. */
export function groundedRepairDiagnostic(code:string,path:RepairPath,candidate:unknown,u:Understanding,factIds:string[],cause:string,source:string):RepairDiagnostic|null{
 const facts=u.event.facts.filter(f=>factIds.includes(f.id));
 if(!facts.length||facts.length!==new Set(factIds).size)return null;
 const spans=facts.flatMap(f=>[f.evidence,...(f.speaker?[f.speaker.evidence]:[])]);
 if(spans.some(e=>source.slice(e.start,e.end)!==e.excerpt))return null;
 return {code,path,current:atPath(candidate,path),expected:'Preserve exactly the material meaning, values, uncertainty and attribution of linked source evidence, with no unsupported addition.',cause,sourceSpans:spans.map(e=>({start:e.start,end:e.end,text:e.excerpt})),factIds,speakerIds:facts.filter(f=>f.speaker).map(f=>f.id+':speaker'),occurrenceIds:spans.map(e=>e.start+':'+e.end),allowedPaths:[path]};
}
export function attachCandidate(error:unknown,candidate:unknown,stage:string):never{
 if(!(error instanceof ProcessingError))throw error;
 const enriched=new ProcessingError(error.code,error.retryable,{...(error.diagnostic??{}),stage,issues:error.diagnostic&&'issues'in error.diagnostic?error.diagnostic.issues:[],output:candidate},error.retryAfterMs);
 enriched.availableDraft=error.availableDraft;throw enriched;
}

/** Collect independently provable output defects together before spending a
 * repair. Passing these checks never replaces the independent semantic review. */
export function validateDirectRepairCandidate(source:string,u:Understanding,candidate:{article:{title:string;body:string}}){
 const ds:RepairDiagnostic[]=[];
 for(const key of ['title','body'] as const){
  const text=candidate.article[key];if(!text)continue;
  const codes:string[]=[];
  if(numericTokens(text).some(n=>!numericTokens(source).includes(n)))codes.push('DIRECT_PUBLICATION_NUMBER_MISMATCH');
  if(sourceLanguage(source)==='ar'){
   if(dateTokens(text).some(d=>!dateTokens(source).includes(d)))codes.push('DIRECT_PUBLICATION_DATE_MISMATCH');
   if(unsupportedQuotes(text,source).length)codes.push('DIRECT_PUBLICATION_QUOTE_MISMATCH');
  }
  for(const code of codes){const d=groundedRepairDiagnostic(code,['article',key],candidate,u,u.event.facts.map(f=>f.id),code,source);if(d){
    const regions=text.match(/[^.!؟\n]+[.!؟\n]*/gu)??[text];
    d.immutableText=regions.filter(region=>!numericTokens(region).some(n=>!numericTokens(source).includes(n))&&!(sourceLanguage(source)==='ar'&&(dateTokens(region).some(date=>!dateTokens(source).includes(date))||unsupportedQuotes(region,source).length)));
    ds.push(d);
   }}
 }
 if(ds.length)throw new ProcessingError(ds[0].code,false,{stage:'direct_combined',issues:ds.map(d=>({code:d.code,path:d.path})),repairDiagnostics:ds,output:candidate});
 validateObjectiveArticle(source,candidate.article.title,candidate.article.body);
}
