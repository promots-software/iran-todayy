import {ProcessingError,checkEvidence,type Understanding} from './contracts';
type Evidence=Understanding['event']['facts'][number]['evidence'];
const bullet=/^\s*[🔹🔸🔻🔺▪▫•●◾◽*-][\s\uFE0E\uFE0F]*/u;
const decoration=/^[\s\uFE0E\uFE0F🔹🔸🔻🔺▪▫•●◾◽⭕*-]*/u;
const headingRole=/(?:^|\s)(?:معاون|وزیر|رئیس|سخنگو|المتحدث|الناطق|وزير|رئيس|مدير|نائب)(?:[\s‌]|$)/u;
const speech=/(?:گفت(?:‌وگو)?|اظهار|اعلام|افزود|تأکید|تصریح|قال|ذكرت|أوضح|صرح|أضاف|says?|said|stated|told|interview)/iu;
const explicitSpeakerRole=/(?:سخنگو|المتحدث|الناطق|spokes(?:person|man|woman))/iu;
const descriptorRole=/^(?:[,،]\s*)?(?:تحلیل[‌ -]?گر|مشاور|محلل|مستشار|analyst|adviser|advisor)(?=[\s‌،,:：]|$)/iu;
/** A speaker heading may govern a contiguous bullet quotation block. Blank
 * lines are layout, but a new heading/narrative or attributed voice ends scope. */
export function validateSpeakerEvidence(source:string,fact:Evidence,speaker:Evidence){
 checkEvidence(source,fact);checkEvidence(source,speaker);
 // Full factual assertions can contain their own explicit attribution prefix.
 // Accept only a leading speaker + colon, or an explicit speech verb; never a
 // person mentioned later as the object of somebody else's claim.
 if(fact.start<=speaker.start&&speaker.end<fact.end){
  const before=source.slice(fact.start,speaker.start).replace(decoration,'').trim();
  const after=source.slice(speaker.end,fact.end);
  if((before===''&&/^\s*[:：]\s*\S/u.test(after)) || (/^(?:قال|أعلن|أكد|أوضح|ذكر|صرح)\s*$/u.test(before)&&/^\s+\S/u.test(after)))return;
 }
 const paragraphStart=source.lastIndexOf('\n',fact.start)+1;
 if(speaker.start>=paragraphStart&&speaker.end<=fact.start)return;
 const lineStart=source.lastIndexOf('\n',speaker.start)+1;
 const lineEnd=source.indexOf('\n',speaker.end);
 if(lineEnd<0||lineEnd>=fact.start)throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 const prefix=source.slice(lineStart,speaker.start).replace(decoration,'').trim();
 const heading=source.slice(speaker.end,lineEnd).trim();
 // A quoted name followed by an explicit descriptive role and colon is an
 // authored speaker heading, not an inferred role or a reference in narration.
 const closing:Record<string,string>={'«':'»','“':'”','"':'"'};
 const quotedHeading=!!closing[prefix]&&heading.startsWith(closing[prefix])&&descriptorRole.test(heading.slice(1).trim());
 if(prefix&&!quotedHeading)throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 if(!/[:：]$/u.test(heading)||(!quotedHeading&&!speech.test(heading)&&!explicitSpeakerRole.test(speaker.excerpt)&&!headingRole.test(speaker.excerpt)))throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 const between=source.slice(lineEnd+1,fact.start);
 const lines=between.split('\n');
 const lead=lines.pop()??'';
 if(lead.replace(bullet,'').trim())throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 for(const line of lines.filter(l=>l.trim())){
  if(!bullet.test(line)||speech.test(line)||/[:：]/u.test(line))throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 }
}
