import {buildAtoms,renderSelection} from './constrained-rewrite';
import {editDraft} from './editorial';
import {draftSchema,ProcessingError,type SourceProfile,type Understanding} from './contracts';

/** Reuse the provider's selection result without accepting its attestations. */
export function finalizeConstrainedDraft(raw:unknown,content:string,u:Understanding,profile:SourceProfile){
 const d=draftSchema.parse(raw),atoms=buildAtoms(content,u);
 const title=atoms.atoms.find(a=>a.renderedText.replace(/\.$/u,'')===d.title);
 const ids=d.body.split('\n').map(text=>atoms.atoms.find(a=>a.renderedText===text)?.id);
 if(!title||ids.some(id=>!id))throw new ProcessingError('CONSTRAINED_TEXT_CHANGED');
 const selection={titleAtomId:title.id,bodyAtomIds:ids};
 const expected=renderSelection(selection,atoms);
 if(JSON.stringify({...d,attestation:expected.attestation})!==JSON.stringify(expected))throw new ProcessingError('CONSTRAINED_DRAFT_CHANGED');
 return finalizeSelection(selection,content,u,profile);
}

/** Reconstruct immutable output locally; never accept model-authored attestations. */
export function finalizeSelection(selection:unknown,content:string,u:Understanding,profile:SourceProfile){
 const draft=renderSelection(selection,buildAtoms(content,u));
 const probe=editDraft(draft,content,u,profile);
 const reasons:Record<string,string>={};
 // This attests preservation of validated atoms, not independent source truth.
 draft.attestation.factsPreserved=true;
 draft.attestation.attributionChecked=!probe.review.some(r=>r.detail==='النسب الصريح مطلوب في العنوان والمتن');
 draft.attestation.numbersChecked=!probe.review.some(r=>r.code==='FORMAT_REVIEW'||r.detail?.startsWith('رقم في المسودة'));
 // No complete deterministic linguistic/title/terminology oracle exists locally.
 draft.attestation.titlesChecked=false;
 draft.attestation.spellingChecked=false;
 draft.attestation.noUncoveredTerms=false;
 reasons.titlesChecked='Human editorial title/rank verification is not established by local checks.';
 reasons.spellingChecked='The local spelling catalogue cannot establish complete linguistic correctness.';
 reasons.noUncoveredTerms='The finite terminology catalogue cannot establish complete coverage; existing term/name flags remain.';
 if(!draft.attestation.attributionChecked)reasons.attributionChecked='Existing explicit attribution check failed.';
 if(!draft.attestation.numbersChecked)reasons.numbersChecked='Existing numeric/format checks require editorial review.';
 const result=editDraft(draft,content,u,profile);
 return {...result,attestations:draft.attestation,attestationReasons:reasons};
}
