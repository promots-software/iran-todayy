import {ProcessingError,checkEvidence,type Understanding} from './contracts';
type Evidence=Understanding['event']['facts'][number]['evidence'];
const bullet=/^[\s🔹🔸🔻🔺▪▫•●◾◽*-]+/u;
const speech=/(?:گفت(?:‌وگو)?|اظهار|اعلام|افزود|تأکید|تصریح|قال|ذكرت|أوضح|صرح|أضاف|says?|said|stated|told|interview)/iu;
/** A speaker heading may govern a contiguous bullet quotation block. Blank
 * lines are layout, but a new heading/narrative or attributed voice ends scope. */
export function validateSpeakerEvidence(source:string,fact:Evidence,speaker:Evidence){
 checkEvidence(source,fact);checkEvidence(source,speaker);
 const paragraphStart=source.lastIndexOf('\n',fact.start)+1;
 if(speaker.start>=paragraphStart&&speaker.end<=fact.start)return;
 const lineStart=source.lastIndexOf('\n',speaker.start)+1;
 const lineEnd=source.indexOf('\n',speaker.end);
 if(lineEnd<0||lineEnd>=fact.start||source.slice(lineStart,speaker.start).trim())throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 const heading=source.slice(speaker.end,lineEnd).trim();
 if(!/[:：]$/u.test(heading)||!speech.test(heading))throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 const between=source.slice(lineEnd+1,fact.start);
 const lines=between.split('\n');
 const lead=lines.pop()??'';
 if(lead.replace(bullet,'').trim())throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 for(const line of lines.filter(l=>l.trim())){
  if(!bullet.test(line)||speech.test(line)||/[:：]/u.test(line))throw new ProcessingError('SPEAKER_ATTRIBUTION_MISMATCH');
 }
}
