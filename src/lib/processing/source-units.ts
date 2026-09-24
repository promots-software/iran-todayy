export type SourceUnit = {id:string;start:number;end:number;text:string;kind:'CONTENT'|'DISTRIBUTION'};
/** Classification view only: never rewrite source bytes or evidence coordinates.
 * Joiners embedded in words remain untouched. Symbols alone have no assertion;
 * letters/numbers always retain a semantic unit (including emoji number keycaps).
 */
export function sourceUnits(source:string):SourceUnit[]{
  let start=0;
  return source.split('\n').flatMap((text,i)=>{
    const unit={id:`u${i+1}`,start,end:start+text.length,text};start=unit.end+1;
    if(!/[\p{L}\p{N}]/u.test(text))return [];
    const view=text.replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,'').trim();
    // Only complete standalone distribution tokens qualify. Prose around a
    // hashtag/link stays CONTENT; outlet identity never exempts source facts.
    const tokens=view.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u,'').split(/\s+/u);
    const distribution=tokens.every(t=>/^(?:https?:\/\/\S+|@[A-Za-z0-9_]+)$/u.test(t));
    return [{...unit,kind:distribution?'DISTRIBUTION' as const:'CONTENT' as const}];
  });
}
