import { ProcessingError, type Understanding } from './contracts';

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
      const excerpt=o.excerpt,context=o.context;
      if(typeof context!=='string'||!context||!excerpt)throw new ProcessingError('EVIDENCE_CONTEXT_REQUIRED');
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
  for(const fact of e.facts) {
    const speaker=fact.speaker;
    if(!speaker){if(fact.kind==='CLAIM'||fact.kind==='STATEMENT')throw new ProcessingError('SPEAKER_ATTRIBUTION_REQUIRED');continue;}
    // Speaker and claim must share the same source paragraph, in source order.
    const paragraphStart=source.lastIndexOf('\n',fact.evidence.start)+1;
    if(speaker.evidence.start<paragraphStart||speaker.evidence.end>fact.evidence.start)throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
    // Explicitly supported Persian translation for an unnamed singular serviceman.
    // Other cross-language identities need a verified mapping; never accept a model's assertion alone.
    if(language==='fa') {
      if(speaker.evidence.excerpt!=='یکی از نظامیان'||! /^(أحد العسكريين|أحد الجنود|عسكري واحد)$/.test(speaker.arabic)||! /^(UNKNOWN_ACTOR|MILITARY_SOURCE|UNNAMED_SERVICEMAN)$/.test(speaker.key))throw new ProcessingError('SPEAKER_TRANSLATION_UNVERIFIED');
    } else if(speaker.arabic!==speaker.evidence.excerpt)throw new ProcessingError('SPEAKER_TRANSLATION_UNVERIFIED');
  }
}
