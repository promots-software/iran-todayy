/** Unicode RGI emoji strings (including ZWJ, modifiers and tag flags), plus
 * unqualified keycaps and isolated regional indicators. Ordinary text symbols
 * such as ©, ™, digits and punctuation are not stripped wholesale.
 * Node 22 supports the Unicode string properties used here.
 */
const emojiPattern='(?:\\p{RGI_Emoji}|[0-9#*]\\uFE0F?\\u20E3|\\p{Regional_Indicator})[\\uFE0E\\uFE0F]*';
const horizontal=(c:string)=>/^[\t\p{Zs}]$/u.test(c);

/** Preserve the raw source separately. Only whitespace touching removed emoji
 * is collapsed; untouched text, line breaks and URL bytes stay unchanged.
 */
export function normalizeProcessingSource(raw:string):string {
 const urls=[...raw.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+/giu)].map(m=>({start:m.index,end:m.index+m[0].length}));
 const spans:{start:number;end:number}[]=[];
 for(const match of raw.matchAll(new RegExp(emojiPattern,'gv'))){
  let start=match.index,end=start+match[0].length;
  // A Unicode URL is source data, not decorative emoji. Never corrupt it.
  if(urls.some(u=>start<u.end&&end>u.start))continue;
  while(start>0&&horizontal(raw[start-1]))start--;
  while(end<raw.length&&horizontal(raw[end]))end++;
  const prior=spans[spans.length-1];
  if(prior&&start<=prior.end)prior.end=Math.max(prior.end,end);
  else spans.push({start,end});
 }
 let result='',cursor=0;
 for(const {start,end} of spans){
  result+=raw.slice(cursor,start);
  if(start>0&&end<raw.length&&!/[\r\n\u2028\u2029]/u.test(raw[start-1]+raw[end]))result+=' ';
  cursor=end;
 }
 return result+raw.slice(cursor);
}

/** Null identifies historical raw-coordinate records. Never reinterpret their
 * saved evidence or checkpoints using a newly introduced normalization.
 */
export function processingSource(post:{originalContent:string;normalizedContent?:string|null}):string {
 return post.normalizedContent??post.originalContent;
}
