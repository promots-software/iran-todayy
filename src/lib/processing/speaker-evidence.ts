import {checkEvidence,type Understanding} from './contracts';
type Evidence=Understanding['event']['facts'][number]['evidence'];
/** The semantic extractor owns the association, including heading continuation.
 * Code proves both sides exist at their declared source positions. Titles, verbs
 * and paragraph layout cannot prove who spoke. Required speaker references and
 * contradictory ID mappings remain checked by the immutable-reference adapters. */
export function validateSpeakerEvidence(source:string,fact:Evidence,speaker:Evidence){
 checkEvidence(source,fact);checkEvidence(source,speaker);
}
