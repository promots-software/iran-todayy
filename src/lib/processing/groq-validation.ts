import {layoutProjection} from './text-equivalence';
import { ProcessingError, type Understanding } from './contracts';
import {validateSpeakerEvidence} from './speaker-evidence';
import {resolveRendering} from './evidence-rendering';

import {sourceLanguage} from './source-language';
export {sourceLanguage} from './source-language';
export function requireArabic(text:string) {
  if(!/[\u0621-\u064a]/u.test(text) || /[پچژگکی]/u.test(text) || /(?:^|\s)(?:که|را|شده|بودند|گفته|است)(?:\s|$)/u.test(text))throw new ProcessingError('NON_ARABIC_OUTPUT');
}
/** Exact UTF-16 ranges take precedence; otherwise require one exact contextual
 * occurrence. No layout rewriting, lexical inference or arbitrary first match. */
export function resolveContextEvidence(value:unknown,source:string,_locationActors?:ReadonlyArray<{start:number;end:number}>):number {
  void _locationActors;
  let aligned=0;
  const occurrences=(text:string,part:string)=>{const found:number[]=[];for(let i=text.indexOf(part);i>=0;i=text.indexOf(part,i+1))found.push(i);return found;};
  function visit(node:unknown){
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){node.forEach(visit);return;}
    const o=node as Record<string,unknown>;
    if(typeof o.excerpt==='string'){
      const excerpt=o.excerpt,context=o.context;
      if(!excerpt)throw new ProcessingError('INVALID_EVIDENCE');
      const explicit=o.startOffset!==undefined&&o.startOffset!==null||o.endOffset!==undefined&&o.endOffset!==null;
      let start:number,end:number;
      const validRange=explicit&&Number.isInteger(o.startOffset)&&Number.isInteger(o.endOffset)&&(o.startOffset as number)>=0&&(o.endOffset as number)>(o.startOffset as number)&&(o.endOffset as number)<=source.length&&source.slice(o.startOffset as number,o.endOffset as number)===excerpt;
      if(validRange){
        start=o.startOffset as number;end=o.endOffset as number;
        if(typeof context!=='string'||!context)throw new ProcessingError('EVIDENCE_CONTEXT_REQUIRED');
        const exactContext=occurrences(source,context).some(base=>base<=start&&base+context.length>=end);
        if(!exactContext){
          const projected=layoutProjection(source),view=layoutProjection(context).value;
          const contextual=occurrences(projected.value,view).some(base=>projected.starts[base]<=start&&projected.ends[base+view.length-1]>=end);
          if(!contextual)throw new ProcessingError('EVIDENCE_CONTEXT_REQUIRED');
        }
      }else{
        // Model offsets are proposals, never evidence. Recover only a locally
        // provable unique occurrence; a bad range cannot select an ambiguous one.
        const exact=occurrences(source,excerpt);
        if(typeof context!=='string'||!context)throw new ProcessingError('EVIDENCE_CONTEXT_REQUIRED');
        if(!exact.length){
          // Whitespace/layout is representation, not a new factual assertion.
          // Resolve back to ORIGINAL bytes and require one contextual occurrence.
          const projection=layoutProjection(source),needle=layoutProjection(excerpt).value,ctx=layoutProjection(context).value;
          const contextual=occurrences(projection.value,ctx);
          const ranges=occurrences(projection.value,needle).filter(at=>contextual.some(base=>base<=at&&base+ctx.length>=at+needle.length));
          if(ranges.length!==1)throw new ProcessingError(ranges.length?'AMBIGUOUS_EVIDENCE_CONTEXT':'INVALID_EVIDENCE');
          start=projection.starts[ranges[0]];end=projection.ends[ranges[0]+needle.length-1];
          o.excerpt=source.slice(start,end);o.start=start;o.end=end;
          delete o.context;delete o.startOffset;delete o.endOffset;aligned++;return;
        }
        const contexts=occurrences(source,context);
        const candidates=[...new Set(contexts.flatMap(base=>occurrences(context,excerpt).map(relative=>base+relative)))];
        const located=candidates.length===1?candidates:exact.length===1?exact:[];
        if(located.length!==1)throw new ProcessingError('AMBIGUOUS_EVIDENCE_CONTEXT');
        start=located[0];end=start+excerpt.length;
      }
      if(o.start!==start||o.end!==end)aligned++;
      o.start=start;o.end=end;delete o.context;delete o.startOffset;delete o.endOffset;
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
  for(const item of [...e.actors,e.action,e.object,e.location,...e.facts,...e.facts.map(f=>f.speaker),...u.names])if(item){
    // Verbatim source evidence is not final generated Arabic. Its language is
    // determined independently from the complete source; offsets are validated
    // by validateUnderstanding. Translated/generated values remain strict.
    if(language!=='ar'||item.arabic!==item.evidence.excerpt)requireArabic(item.arabic);
  }
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
