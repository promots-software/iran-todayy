/** Display-only proposal. Never a validation receipt, approval, or publishable object. */
export type AvailableDraft={version:'available-draft-v1';validated:false;title:string;body:string;origin:'MODEL_PROPOSAL';reason:string};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
function text(v:unknown){return typeof v==='string'&&v.length<=20000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)&&/[\u0621-\u064a]/.test(v)&&!/[پچژگکی]/.test(v)?v:null;}
export function availableDraft(raw:unknown,reason:string):AvailableDraft|null{
 const r=object(raw),title=text(r.title),body=r.body===''?'':text(r.body);
 if(!title||body===null)return null;
 return {version:'available-draft-v1',validated:false,title,body,origin:'MODEL_PROPOSAL',reason};
}
export function proposalDraft(raw:unknown,reason:string):AvailableDraft|null{
 const r=object(raw),p=object(r.publication),title=object(p.title).text;
 if(typeof title==='string'&&Array.isArray(p.body))return availableDraft({title,body:p.body.map(v=>object(v).text).filter(v=>typeof v==='string').join('\n\n')},reason);
 // Attached Persian/English translations are proposals, not validated Arabic.
 // Display verbatim proposed factual sentences; do not invent connective text.
 if(Array.isArray(r.statements)){
  const sentences=r.statements.map(v=>object(object(v).evidence).arabic);
  if(sentences.length&&sentences.every(v=>text(v)))return availableDraft({title:sentences[0],body:sentences.slice(1).join('\n\n')},reason);
 }
 return availableDraft(r,reason);
}
export function reviewPrefill(result:unknown){const r=object(result);return availableDraft(r.availableDraft,String(object(r.availableDraft).reason??'REVIEW_REQUIRED'))??availableDraft(r.draft,'REVIEW_REQUIRED');}
