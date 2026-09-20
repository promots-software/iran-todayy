import { ProcessingError, type Understanding } from './contracts';
import {validateSpeakerEvidence} from './speaker-evidence';
import {resolveRendering} from './evidence-rendering';

import {sourceLanguage} from './source-language';
export {sourceLanguage} from './source-language';
export function requireArabic(text:string) {
  if(!/[\u0621-\u064a]/u.test(text) || /[پچژگکی]/u.test(text) || /(?:^|\s)(?:که|را|شده|بودند|گفته|است)(?:\s|$)/u.test(text))throw new ProcessingError('NON_ARABIC_OUTPUT');
}
/** All evidence must identify exactly one source occurrence, including repeated excerpts. */
export function resolveContextEvidence(value:unknown,source:string):number {
  let aligned=0;
  function visit(node:unknown){
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){node.forEach(visit);return;}
    const o=node as Record<string,unknown>;
    if(typeof o.excerpt==='string') {
      const excerpt=o.excerpt,rawContext=o.context;
      if(typeof rawContext!=='string'||!rawContext||!excerpt)throw new ProcessingError('EVIDENCE_CONTEXT_REQUIRED');
      let context=rawContext;
      // Repair only equal-length space-codepoint changes in surrounding context.
      // Never normalize the factual excerpt, punctuation, words or source text.
      if(!source.includes(context)){
        const spaces=(text:string)=>text.replace(/[\u00a0\u202f]/gu,' ');
        const normalized=spaces(source),needle=spaces(context),at=normalized.indexOf(needle);
        if(at>=0&&normalized.lastIndexOf(needle)===at)context=source.slice(at,at+context.length);
      }
      const base=source.indexOf(context),relative=context.indexOf(excerpt);
      if(base<0||source.lastIndexOf(context)!==base||relative<0||context.lastIndexOf(excerpt)!==relative)throw new ProcessingError('AMBIGUOUS_EVIDENCE_CONTEXT');
      const start=base+relative,end=start+excerpt.length;
      if(o.start!==start||o.end!==end)aligned++;
      o.start=start;o.end=end;delete o.context;
      return;
    }
    Object.values(o).forEach(visit);
  }
  visit(value);return aligned;
}
export function validateExtractionLanguageAndSpeakers(u:Pick<Understanding,'language'|'event'|'names'>,source:string) {
  const language=sourceLanguage(source);
  if(language==='unknown')throw new ProcessingError('SOURCE_LANGUAGE_UNCERTAIN');
  if(u.language!==language)throw new ProcessingError('SOURCE_LANGUAGE_MISMATCH');
  const e=u.event;
  for(const item of [...e.actors,e.action,e.object,e.location,...e.facts,...e.facts.map(f=>f.speaker),...u.names])if(item)requireArabic(item.arabic);
  if(e.summary!==null)requireArabic(e.summary);
  const renderingRefs=e.facts.flatMap(f=>[
    {id:f.id,role:'fact',evidence:f.evidence},
    ...(f.speaker?[{id:`${f.id}:speaker`,role:'speaker',evidence:f.speaker.evidence}]:[]),
  ]);
  const translations=language!=='ar'?resolveRendering(source,renderingRefs,(u as Understanding).rendering):null;
  for(const fact of e.facts) {
    const speaker=fact.speaker;
    if(!speaker){if(fact.kind==='CLAIM'||fact.kind==='STATEMENT')throw new ProcessingError('SPEAKER_ATTRIBUTION_REQUIRED');continue;}
    validateSpeakerEvidence(source,fact.evidence,speaker.evidence);
    if(language!=='ar') {
      if(translations?.get(fact.id)!==fact.arabic||translations?.get(`${fact.id}:speaker`)!==speaker.arabic)throw new ProcessingError('SPEAKER_TRANSLATION_UNVERIFIED');
    } else if(speaker.arabic!==speaker.evidence.excerpt)throw new ProcessingError('SPEAKER_TRANSLATION_UNVERIFIED');
  }
}
