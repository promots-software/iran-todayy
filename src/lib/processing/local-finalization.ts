import {finalizeBodyPunctuation} from '../publication-finalization';
import {publicationDraft} from './direct-publication';
import {buildAtoms,renderSelection} from './constrained-rewrite';
import {editDraft} from './editorial';
import {draftSchema,ProcessingError,type SourceProfile,type Understanding} from './contracts';
import {hasEditorialGrounding,unresolvedTerms} from './editorial-grounding';
import {newsroomPrefix} from './newsroom-format';

/** Reuse the provider's selection result without accepting its attestations. */
export function finalizeConstrainedDraft(raw:unknown,content:string,u:Understanding,profile:SourceProfile){
 let value=raw;
 if(raw&&typeof raw==='object'&&'normalGeneration' in raw){
  const {normalGeneration,...draft}=raw;
  if(JSON.stringify(normalGeneration)!==JSON.stringify(u.publicationProposal))throw new ProcessingError('AI_CANONICAL_RENDER_REQUIRED');
  value=draft;
 }
 const d=draftSchema.parse(value);
 if(u.publicationProposal){
  const expected=publicationDraft(content,u);
  if(JSON.stringify(d)!==JSON.stringify(draftSchema.parse(expected)))throw new ProcessingError('CONSTRAINED_DRAFT_CHANGED');
  return finalizeValidatedDraft(expected,content,u,profile);
 }
 const atoms=buildAtoms(content,u);
 const titleLink=d.sentences.find(s=>s.text===d.title);
 const statement=atoms.format==='STATEMENT';
 const title=atoms.atoms.find(a=>titleLink?.factIds.length===1&&titleLink.factIds[0]===a.id&&newsroomPrefix+(statement?a.attribution:a.renderedText.replace(/\.$/u,''))===d.title);
 // Recover selection by immutable provenance, not by splitting prose (an atom
 // may itself contain paragraphs or the same text as another evidence span).
 const ids=[...(statement?[]:[title?.id]),...d.sentences.filter(s=>s!==titleLink).map(s=>s.factIds.length===1?atoms.atoms.find(a=>a.id===s.factIds[0]&&(statement?`- ${a.text}`:a.renderedText)===s.text)?.id:undefined)];
 if(!title||ids.some(id=>!id))throw new ProcessingError('CONSTRAINED_TEXT_CHANGED');
 const selection={titleAtomId:title.id,bodyAtomIds:ids};
 const expected=renderSelection(selection,atoms);
 if(JSON.stringify({...d,attestation:expected.attestation})!==JSON.stringify(expected))throw new ProcessingError('CONSTRAINED_DRAFT_CHANGED');
 return finalizeSelection(selection,content,u,profile);
}

/** Reconstruct immutable output locally; never accept model-authored attestations. */
export function finalizeSelection(selection:unknown,content:string,u:Understanding,profile:SourceProfile){
 return finalizeValidatedDraft(renderSelection(selection,buildAtoms(content,u)),content,u,profile);
}
function finalizeValidatedDraft(draft:ReturnType<typeof renderSelection>,content:string,u:Understanding,profile:SourceProfile){
 const probe=editDraft(draft,content,u,profile);
 const reasons:Record<string,string>={};
 // This attests preservation of validated atoms, not independent source truth.
 const grounded=hasEditorialGrounding(u,content);
 draft.attestation.factsPreserved=grounded;
 draft.attestation.attributionChecked=!probe.review.some(r=>r.detail==='النسب الصريح مطلوب في العنوان والمتن');
 // Evidence-linked digit equality is deterministic. Narrative formatting can
 // still require human review without falsely becoming unsupported output.
 draft.attestation.numbersChecked=!probe.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'&&r.detail?.startsWith('رقم في المسودة'));
 // Attest only source fidelity and the configured deterministic checks, not
 // independent truth, office currency, perfect style or human approval.
 draft.attestation.titlesChecked=grounded;
 draft.attestation.spellingChecked=grounded;
 draft.attestation.noUncoveredTerms=grounded&&!unresolvedTerms(u,content).length;
 if(!grounded){reasons.titlesChecked='Title/name fidelity has not been established.';reasons.spellingChecked='Validated Arabic source/rendering is required.';}
 if(!draft.attestation.noUncoveredTerms)reasons.noUncoveredTerms='Explicit unresolved terminology remains.';
 if(!draft.attestation.attributionChecked)reasons.attributionChecked='Existing explicit attribution check failed.';
 if(!draft.attestation.numbersChecked)reasons.numbersChecked='Existing numeric/format checks require editorial review.';
 const result=editDraft(draft,content,u,profile);
 if(u.publicationProposal&&!result.body){
  const old=result.title,next=finalizeBodyPunctuation(old);
  if(next!==old){const entry=result.sentenceEvidence.find(s=>s.text===old);if(!entry)throw new ProcessingError('MISSING_TITLE_PROVENANCE');entry.text=next;result.title=next;}
 }
 return {...result,attestations:draft.attestation,attestationReasons:reasons};
}

/** One deterministic repair from already grounded immutable facts, never a model loop. */
export function finalizeWithRepair(raw:unknown,content:string,u:Understanding,profile:SourceProfile,constrained:boolean){
 const finalize=(value:unknown)=>constrained?finalizeConstrainedDraft(value,content,u,profile):editDraft(value,content,u,profile);
 let original:ReturnType<typeof finalize>|undefined;
 try{
  original=finalize(raw);
  if(!original.review.some(r=>r.code==='UNSUPPORTED_OUTPUT'||(r.code==='QUOTE_REVIEW'&&r.detail)))return original;
 }catch(error){
  if(!(error instanceof ProcessingError)||!['CONSTRAINED_DRAFT_CHANGED','CONSTRAINED_TEXT_CHANGED','MISSING_TITLE_PROVENANCE','INVALID_DRAFT_FACT_LINK','UNSUPPORTED_OUTPUT'].includes(error.code))throw error;
  if(!hasEditorialGrounding(u,content))throw error;
 }
 if(!hasEditorialGrounding(u,content))return original!;
 const atoms=buildAtoms(content,u);
 const repaired=u.publicationProposal?publicationDraft(content,u):renderSelection({titleAtomId:atoms.atoms[0].id,bodyAtomIds:atoms.atoms.map(a=>a.id)},atoms);
 return {...finalizeConstrainedDraft(repaired,content,u,profile),repair:{attempts:1,method:'IMMUTABLE_FACTS'}};
}
