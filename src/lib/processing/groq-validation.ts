import {layoutProjection} from './text-equivalence';
import { ProcessingError, type Understanding } from './contracts';
import {validateSpeakerEvidence} from './speaker-evidence';
import {resolveRendering} from './evidence-rendering';

import {sourceLanguage} from './source-language';
export {sourceLanguage} from './source-language';
export function requireArabic(text:string) {
  if(!/[\u0621-\u064a]/u.test(text) || /[پچژگکی]/u.test(text) || /(?:^|\s)(?:که|را|شده|بودند|گفته|است)(?:\s|$)/u.test(text))throw new ProcessingError('NON_ARABIC_OUTPUT');
}
/** All evidence must identify exactly one source occurrence, including repeated excerpts. */
export function resolveContextEvidence(value:unknown,source:string,locationActors?:ReadonlyArray<{start:number;end:number}>):number {
  let aligned=0;
  function visit(node:unknown){
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){node.forEach(visit);return;}
    const o=node as Record<string,unknown>;
    if(typeof o.excerpt==='string') {
      const excerpt=o.excerpt,rawContext=o.context;
      if(typeof rawContext!=='string'||!rawContext||!excerpt)throw new ProcessingError('EVIDENCE_CONTEXT_REQUIRED');
      let contextView=layoutProjection(rawContext).value;
      const sourceView=layoutProjection(source);
      let base=sourceView.value.indexOf(contextView);
      const excerptView=layoutProjection(excerpt).value;
      // One deterministic context repair: a globally unique verbatim excerpt
      // needs no model-selected context. Speaker scope is checked separately.
      const unique=sourceView.value.indexOf(excerptView);
      if(excerptView&&unique>=0&&sourceView.value.lastIndexOf(excerptView)===unique&&
        (base<0||sourceView.value.lastIndexOf(contextView)!==base||!contextView.includes(excerptView))){
        contextView=excerptView;base=unique;
      }
      if(base<0||sourceView.value.lastIndexOf(contextView)!==base)throw new ProcessingError('AMBIGUOUS_EVIDENCE_CONTEXT');
      if(!contextView||!excerptView)throw new ProcessingError('EVIDENCE_CONTEXT_REQUIRED');
      let relative=contextView.indexOf(excerptView);
      if(relative<0)throw new ProcessingError('AMBIGUOUS_EVIDENCE_CONTEXT');
      if(contextView.lastIndexOf(excerptView)!==relative){
        // Location-only structural proof: every other occurrence belongs to an
        // already validated actor span, and the sole remaining one has an explicit
        // locative preposition. Never resolve a repeated fact/speaker this way.
        const outside:number[]=[];
        for(let i=relative;i>=0;i=contextView.indexOf(excerptView,i+1)){
          const a=sourceView.starts[base+i],b=sourceView.ends[base+i+excerptView.length-1];
          if(!locationActors?.some(actor=>actor.start<=a&&actor.end>=b))outside.push(i);
        }
        if(!locationActors?.length||outside.length!==1||!/(?:^|[\s،,:;])(?:في|داخل|در|in|at)\s+$/iu.test(contextView.slice(0,outside[0])))throw new ProcessingError('AMBIGUOUS_EVIDENCE_CONTEXT');
        relative=outside[0];
      }
      const start=sourceView.starts[base+relative],end=sourceView.ends[base+relative+excerptView.length-1];
      // Restore the exact original source slice; immutable evidence/offset checks remain byte-exact.
      o.excerpt=source.slice(start,end);
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
