import {ProcessingError,checkEvidence,type Understanding} from './contracts';
type Evidence=Understanding['event']['facts'][number]['evidence'];
const bullet=/^\s*[🔹🔸🔻🔺▪▫•●◾◽*-][\s\uFE0E\uFE0F]*/u;
const decoration=/^[\s\uFE0E\uFE0F🔹🔸🔻🔺▪▫•●◾◽⭕*-]*/u;
const headingRole=/(?:^|\s)(?:معاون|وزیر|رئیس|سخنگو|المتحدث|الناطق|وزير|رئيس|مدير|نائب)(?:[\s‌]|$)/u;
const speech=/(?:گفت(?:‌وگو)?|اظهار|اعلام|افزود|تأکید|تصریح|قال|ذكرت|أوضح|صرح|أضاف|says?|said|stated|told|interview)/iu;
const explicitSpeakerRole=/(?:سخنگو|المتحدث|الناطق|spokes(?:person|man|woman))/iu;
const descriptorRole=/^(?:[,،]\s*)?(?:تحلیل[‌ -]?گر|مشاور|محلل|مستشار|analyst|adviser|advisor)(?=[\s‌،,:：]|$)/iu;
const arabicIntroduction=/^(?:[وف])?(?:قالت?|أعلنت?|أكدت?|أوضحت?|ذكرت?|صرحت?|أضافت?)\s*$/u;
const persianIntroduction=/^\s+(?:اعلام کرد|اظهار کرد|تأکید کرد|تصریح کرد|گفت|افزود)(?:[\s،:：]|$)/u;
const arabicSpeakerFirst=/^\s+(?:قالت?|أعلنت?|أكدت?|أوضحت?|ذكرت?|صرحت?|أضافت?)(?:\s|[،:：])/u;
/** Conservative title noun phrase immediately preceding an explicitly extracted
 * name. No inferred identity: the name's evidence and heading colon stay exact.
 * Coordinated people, narrative verbs and unrestricted prepositions are excluded. */
function titlePrefix(prefix:string){
 const words=prefix.replace(/[,،]\s*$/u,'').trim().split(/\s+/u);
 const role=/^(?:أمين|رئيس|وزير|مدير|نائب|محافظ|اللواء|الفريق|العميد|المتحدث)$/u;
 return words.length>0&&words.length<=12&&role.test(words[0])&&words.every(w=>role.test(w)||/^(?:ال|لل|للأ)[\p{L}\p{M}]+$/u.test(w))&&!speech.test(prefix);
}
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
  // A source-stated locative qualifier between the leading speaker and colon
  // does not change who owns the explicit heading. Never cross another voice.
  const qualifiedHeading=/^\s+في\s+[\p{L}\p{M} ‌-]{1,80}[:：]\s*\S/u.exec(after);
  const explicitQualified=!!qualifiedHeading&&!speech.test(qualifiedHeading[0].split(/[:：]/u)[0])&&!/\s(?:و(?=\p{L}|\s)|(?:عن|ضد)\s)/u.test(qualifiedHeading[0]);
  if((before===''&&(explicitQualified||/^\s*[:：]\s*\S/u.test(after)||persianIntroduction.test(after)||arabicSpeakerFirst.test(after))) || (arabicIntroduction.test(before)&&/^(?:\s+|\s*[:：]\s*)\S/u.test(after)))return;
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
 const titledHeading=titlePrefix(prefix)&&/^[:：]$/u.test(heading);
 if(prefix&&!quotedHeading&&!titledHeading)throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 if(!/[:：]$/u.test(heading)||(!titledHeading&&!quotedHeading&&!speech.test(heading)&&!explicitSpeakerRole.test(speaker.excerpt)&&!headingRole.test(speaker.excerpt)))throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 const between=source.slice(lineEnd+1,fact.start);
 const lines=between.split('\n');
 const lead=lines.pop()??'';
 const continuation=lead.replace(bullet,'').trim();
 // Within the first quoted paragraph, later sentences retain the explicit
 // heading speaker only when no new speech act or colon introduces a voice.
 // Do not carry attribution through a separate narrative paragraph.
 if(continuation&&(!titledHeading||lines.some(l=>l.trim())||speech.test(continuation)||/[:：]/u.test(continuation)||!/[.!؟?]\s*$/u.test(continuation)))throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 for(const line of lines.filter(l=>l.trim())){
  if(!bullet.test(line)||speech.test(line)||/[:：]/u.test(line))throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 }
}
