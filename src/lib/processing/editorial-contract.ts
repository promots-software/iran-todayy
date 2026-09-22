import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

/** Exact user-supplied artifact, not a generated or summarized prompt. */
export const EDITORIAL_CONTRACT_SHA256='9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456';
export function validateEditorialContract(bytes:Buffer):string {
 if(createHash('sha256').update(bytes).digest('hex')!==EDITORIAL_CONTRACT_SHA256)throw new Error('EDITORIAL_CONTRACT_INTEGRITY_FAILED');
 const text=bytes.toString('utf8');
 const sections=[...text.matchAll(/^(\d+)\. /gm)].map(m=>Number(m[1]));
 if(sections.length!==40||sections.some((n,i)=>n!==i+1))throw new Error('EDITORIAL_CONTRACT_SECTIONS_MISSING');
 return text;
}
export const editorialContract=validateEditorialContract(readFileSync(join(process.cwd(),'config/editorial/iran-now-contract.txt')));
/** Section 3 uses quotation marks as terminology typography, not reported speech.
 * The exact underlying word must still occur in grounded source/rendering text. */
export function isGroundedTerminologyQuote(quote:string,evidence:string):boolean {
 if(!/^"(?:إسرائيل|(?:ال)?إسرائيلي(?:ة|ون|ين|اً)?)"$/u.test(quote))return false;
 const word=quote.slice(1,-1);
 return evidence.includes(word);
}
/** Structured fields are the transport envelope; the attached file governs copy.
 * Source evidence remains factual authority, including when style examples contain
 * facts that do not occur in this source. No truncation or fallback prompt. */
export function withEditorialContract(instructions:string):string {
 return instructions+'\nAUTHORITATIVE WRITING CONTRACT (all 40 sections; applies to every generated Arabic field and all repair attempts). The source controls facts. Examples are never evidence for this story. This complete contract supersedes legacy style guidance; structural JSON and evidence IDs are transport/provenance requirements, not alternative writing rules.\nBEGIN_COMPLETE_EDITORIAL_CONTRACT\n'+editorialContract+'\nEND_COMPLETE_EDITORIAL_CONTRACT';
}
