import {receiptRepairCores} from './receipt-preservation';
import {resolveContextEvidence} from './groq-validation';
import {validateObjectiveArticle} from './direct-publication';
import {numericTokens,dateTokens,repairTextRegions} from './text-equivalence';
import {unsupportedQuotes} from './quote-integrity';
import {sourceLanguage} from './source-language';
import {requireArabic} from './groq-validation';
import {ProcessingError,type Understanding} from './contracts';
import {atPath,type RepairDiagnostic,type RepairPath} from './targeted-repair';
import {fidelityLedgerSchema,validateFidelityReceipt} from './fidelity-ledger';
import {sourceUnits} from './source-units';

/** Repair semantic defects only after an independent review identifies them;
 * absent/ambiguous source evidence cannot be repaired by generated prose. */
export function fidelityRepairDiagnostics(raw:unknown,source:string,u:Understanding,candidate:unknown,direct=false){
 const parsed=fidelityLedgerSchema.safeParse(raw);if(!parsed.success)return [];
 const article=direct?(candidate as {article?:{title:string;body:string}})?.article:undefined;
 const proposal=!direct?(candidate as {publication?:{title:{text:string};body:{text:string}[]}})?.publication:undefined;
 const publication=article?[{id:'title',text:article.title},...(article.body?[{id:'body:1',text:article.body}]:[])]:proposal?[{id:'title',text:proposal.title.text},...proposal.body.map((p,i)=>({id:'body:'+(i+1),text:p.text}))]:[];
 try{validateFidelityReceipt(source,publication,raw);}catch{return [];}
 const cores=receiptRepairCores(raw,{originalSource:source,publication});

 // A repairable clause cannot authorize rewriting around unresolved evidence.
 if(parsed.data.claims.some(c=>c.components.some(p=>p.verdict==='UNCERTAIN'))||parsed.data.sourceCoverage.some(c=>c.disposition==='UNCERTAIN'||c.temporal.some(t=>t.assessment==='UNCERTAIN')))return [];
 const units=sourceUnits(source),ds:RepairDiagnostic[]=[];
 const add=(id:string,unitIds:string[],cause:string,code:string)=>{
  const linked=units.filter(unit=>unitIds.includes(unit.id));
  const ids=u.event.facts.filter(f=>linked.some(unit=>f.evidence.start<unit.end&&f.evidence.end>unit.start)).map(f=>f.id);
  const path:RepairPath=direct?['article',id==='title'?'title':'body']:id==='title'?['publication','title','text']:['publication','body',Number(id.split(':')[1])-1,'text'];
  if(typeof atPath(candidate,path)!=='string')return;
  const d=groundedRepairDiagnostic(code,path,candidate,u,ids,cause,source);if(d&&!ds.some(existing=>existing.code===d.code&&JSON.stringify(existing.path)===JSON.stringify(d.path)))ds.push(d);
 };
 for(const claim of parsed.data.claims)for(const part of claim.components)if(part.verdict==='UNSUPPORTED')add(claim.publicationId,part.sourceUnitIds,'STRUCTURED_UNSUPPORTED_COMPONENT','UNSUPPORTED_ASSERTION');
 for(const row of parsed.data.sourceCoverage)for(const t of row.temporal)if(t.assessment==='CHANGED')add(t.publicationId,[row.unitId],'STRUCTURED_TEMPORAL_CHANGE','UNSUPPORTED_ASSERTION');
 // Missing source material requires a real already-extracted supporting fact.
 for(const row of parsed.data.sourceCoverage)if(row.disposition==='MISSING')add(direct?'body:1':'body:1',[row.unitId],'STRUCTURED_MISSING_SOURCE_UNIT','MISSING_SUPPORTED_FACT');
 for(const d of ds){
  const id=direct?(d.path[1]==='title'?'title':'body:1'):d.path[1]==='title'?'title':'body:'+ (Number(d.path[2])+1);
  const text=atPath(candidate,d.path);if(typeof text!=='string')continue;
  const parts=parsed.data.claims.filter(c=>c.publicationId===id).flatMap(c=>c.components).filter(p=>p.verdict==='UNSUPPORTED');
  if(!parts.length&&cores===undefined)continue;
  const editable=new Uint8Array(text.length);
  const span=(excerpt:string)=>{const e={excerpt,context:text,start:0,end:0};resolveContextEvidence(e,text);return e;};
  if(cores!==undefined){for(const core of cores.filter(c=>c.publicationId===id))editable.fill(1,core.start,core.end);}
  else for(const part of parts){const e=span(part.excerpt);editable.fill(1,e.start,e.end);}
  // A broad rejected component never grants permission over a supported one.
  for(const part of parsed.data.claims.filter(c=>c.publicationId===id).flatMap(c=>c.components).filter(p=>p.verdict==='SUPPORTED')){const e=span(part.excerpt);editable.fill(0,e.start,e.end);}
  const immutable:string[]=[];let start=0;for(let i=0;i<=text.length;i++){if(i===text.length||editable[i]){if(i>start)immutable.push(text.slice(start,i));start=i+1;}}
  d.immutableText=immutable;
 }
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
  try{requireArabic(text);}catch(e){if(e instanceof ProcessingError&&e.code==='NON_ARABIC_OUTPUT')codes.push(e.code);else throw e;}
  if(numericTokens(text).some(n=>!numericTokens(source).includes(n)))codes.push('DIRECT_PUBLICATION_NUMBER_MISMATCH');
  if(sourceLanguage(source)==='ar'){
   if(dateTokens(text).some(d=>!dateTokens(source).includes(d)))codes.push('DIRECT_PUBLICATION_DATE_MISMATCH');
   if(unsupportedQuotes(text,source).length)codes.push('DIRECT_PUBLICATION_QUOTE_MISMATCH');
  }
  for(const code of codes){const d=groundedRepairDiagnostic(code,['article',key],candidate,u,u.event.facts.map(f=>f.id),code,source);if(d){
    const regions=repairTextRegions(text);
    d.expected=JSON.stringify({instruction:'Correct only the diagnosed grounded values; do not transfer values between facts or infer date components.',facts:u.event.facts.map(f=>({factId:f.id,occurrence:[f.evidence.start,f.evidence.end],numbers:numericTokens(f.evidence.excerpt),dates:dateTokens(f.evidence.excerpt)})),candidateNumbers:numericTokens(text),candidateDates:dateTokens(text)});
    if(code!=='NON_ARABIC_OUTPUT')d.immutableText=regions.filter(region=>!numericTokens(region).some(n=>!numericTokens(source).includes(n))&&!(sourceLanguage(source)==='ar'&&(dateTokens(region).some(date=>!dateTokens(source).includes(date))||unsupportedQuotes(region,source).length)));
    ds.push(d);
   }}
 }
 if(ds.length)throw new ProcessingError(ds[0].code,false,{stage:'direct_combined',issues:ds.map(d=>({code:d.code,path:d.path})),repairDiagnostics:ds,output:candidate});
 validateObjectiveArticle(source,candidate.article.title,candidate.article.body);
}
