import type { Understanding } from './contracts';
import { checkEvidence } from './contracts';
import { ruleSet } from './rules';

export function allowedRuleDecisions(rules = ruleSet) {
 return rules.terminology.flatMap(r=>r.from.flatMap(from=>r.to.map(to=>({ruleId:r.id,from,to}))));
}
export type RuleChoice = ReturnType<typeof allowedRuleDecisions>[number];

export function relevantRuleDecisions(understanding:Understanding, rules = ruleSet) {
 // Only validated fact/speaker wording is a rewrite context. Never use unrelated
 // source paragraphs, inferred anchors, or surrounding disambiguation context.
 const text=understanding.event.facts.flatMap(f=>[f.arabic,f.evidence.excerpt,...(f.speaker?[f.speaker.arabic,f.speaker.evidence.excerpt]:[])]).join('\n');
 return allowedRuleDecisions(rules).filter(choice=>{
  const escaped=choice.from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,'u').test(text);
 });
}

/** Constrain whole tuples, not independent enums that allow invalid cross-rule combinations. */
export function constrainRewriteDecisions(schema:unknown, tuples:RuleChoice[] = []) {
 const root=schema as {properties:{decisions:{items:Record<string,unknown>;maxItems?:number}}};
 const decisions=root.properties.decisions;
 const item=decisions.items;
 const properties=item.properties as Record<string,unknown>;
 if(!tuples.length){decisions.maxItems=0;return schema;}
 decisions.items={anyOf:tuples.map(tuple=>({...item,properties:{...properties,
  ruleId:{type:'string',enum:[tuple.ruleId]},from:{type:'string',enum:[tuple.from]},to:{type:'string',enum:[tuple.to]},
 }}))};
 return schema;
}

export const scopePreservationInstructions = 'Paraphrase only with the same factual scope: preserve the subject, affected audience, predicate, negation, quantifiers, modality and attribution. Do not resolve pronouns or possessives into a country, entity or ownership relationship unless the linked validated facts explicitly establish the referent. If unresolved, preserve the attributed reference or use narrower neutral wording without changing the predicate. A statement that a particular audience was not informed does not establish that something was never announced, disclosed or known generally. Do not broaden a limited communication or knowledge claim into universal secrecy or non-disclosure. Check title and body independently; headline compression must not broaden scope. If equivalence is uncertain, preserve the supported wording and mark the relevant attestation false for review.';

export const attributionInstructions = 'For attributed claims, both title and body must explicitly attribute to the validated speaker using appropriate wording containing one of the existing validator forms: حسب، ذكرت، نقلت، قال، زعم، ادّعى، ادعى. A speaker name followed only by a colon does not satisfy this requirement. Do not invent a speaker or change claim certainty merely to include an attribution verb. Give the entire title its own supported factIds entry.';

export const rewriteInstructions = 'Generate Arabic using ONLY validatedFacts and their explicit speakers. Every assertion in each title/body sentence must be supported by the factIds assigned to that sentence; attaching an ID does not license additional details. Include the complete title as a sentences entry with non-empty factIds, plus every body sentence. Never draw new assertions from evidence context, metadata, event anchors or background knowledge. Preserve claim status, attribution and uncertainty. Never infer nationality, affiliation, ownership, role, identity, location, time, motive or relationships unless the linked validated fact explicitly establishes that attribute or relationship. An attribute of an object or institution does not establish the same attribute of its speaker. Possessive wording must not invent ownership, citizenship, affiliation or relationships. Preserve unspecified attributes as unspecified and prefer narrower wording over inference. Do not invent numbers. Review every assertion against its linked facts before returning; valid factIds alone do not prove semantic grounding. Translations and paraphrases are not literal quotes. A QUOTE protectedSpan is permitted only for a verbatim source literal quote actually preserved in the output, including its original quotation delimiters; otherwise use no QUOTE span. Never protect translated text as literal source text. decisions are terminology replacements only: choose only an exact ruleId/from/to tuple from allowedRuleDecisions, preserving every character. Never mix tuples, invent IDs, extend phrases, or turn general policy or spelling advice into a replacement decision. A supplied tuple is permission only when its rule conditions and source evidence apply; otherwise omit it. Attribution is required prose, not an invented ATTRIBUTION decision. If no supported replacement applies, decisions is []. Apply the supplied editorial rules in order. Evidence offsets refer to the original source and contexts are verbatim. Attestations must be honest; uncertainty requires review. Hashtags are separate. No publishing or tools. '+scopePreservationInstructions+' '+attributionInstructions;

/** Minimize factual exposure: the rewrite receives facts, not the unextracted source. */
export function rewriteInput(content:string, understanding:Understanding, rules = ruleSet) {
 const evidence=(e:Understanding['event']['facts'][number]['evidence'])=>{
  checkEvidence(content,e);
  let start=e.start,end=e.end;
  while(content.indexOf(content.slice(start,end))!==content.lastIndexOf(content.slice(start,end)) && (start>0||end<content.length)) {
   start=Math.max(0,start-1);end=Math.min(content.length,end+1);
  }
  return {...e,context:content.slice(start,end)};
 };
 return {allowedRuleDecisions:relevantRuleDecisions(understanding,rules),validatedFacts:understanding.event.facts.map(f=>({...f,evidence:evidence(f.evidence),speaker:f.speaker?{...f.speaker,evidence:evidence(f.speaker.evidence)}:null}))};
}
