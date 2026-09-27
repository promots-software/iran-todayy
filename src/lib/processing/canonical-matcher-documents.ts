import {canonicalDigest} from './canonical-flow';
import type {Candidate} from './matcher';

export const matcherDocumentDefaults={kind:'STATEMENT',material:true,verified:false} as const;
/** Wire-only projection. Original candidate, fact IDs, source IDs and exact
 * coordinates remain in the frozen local snapshot. No evidence text is cut. */
export function compactMatcherCandidate(candidate:Candidate,index:number){
 const documents=candidate.data.facts.map(f=>({
  source:f.evidence.excerpt,arabic:f.arabic,
  // Only a provably derivable content hash is transport noise. Keep semantic keys.
  ...(f.key!==canonicalDigest(f.evidence.excerpt)?{key:f.key}:{}),
  ...(f.speaker?{speaker:f.speaker}:{}),
  ...(f.kind!==matcherDocumentDefaults.kind?{kind:f.kind}:{}),
  ...(f.material!==matcherDocumentDefaults.material?{material:f.material}:{}),
  ...(f.verified!==matcherDocumentDefaults.verified?{verified:f.verified}:{})
 }));
 const compact:Record<string,unknown>={id:`c${index}`,publishedAt:candidate.publishedAt.toISOString(),documents};
 for(const [key,value]of Object.entries(candidate.data)){
  if(key==='facts')continue;
  if(key==='summary'&&documents.some(d=>d.arabic.split('\n')[0]===value))continue;
  if(value!==null&&(!Array.isArray(value)||value.length))compact[key]=value;
 }
 return compact;
}
export const matcherDocumentInstructions='Candidate transport only: documents preserve original source evidence and Arabic text. documentDefaults applies only when a document omits that field; explicit values override it. Omitted empty/null event fields contain no information. A summary may be omitted only when identical to a document Arabic first line. Fact IDs, source IDs, evidence offsets and content-hash keys remain bound locally; speaker attribution and all meaningful event fields remain supplied. verified is independent truth verification, not source grounding. Assess the same occurrence/material-update/conflict rules using all supplied documents.';
