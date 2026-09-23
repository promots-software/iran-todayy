import {editorialLabels,readEditorialState,reviewMessages,technicalExplanation,type ReasonInput} from '@/lib/processing/editorial-eligibility';
import {Badge} from './ui';
export function EditorialState({value,status,error}:{value:unknown;status:string;error?:string|null}){
 if(!['NEEDS_REVIEW','PENDING_APPROVAL','FILTERED','REJECTED','FAILED'].includes(status))return <Badge value={status}/>;
 const state=readEditorialState(value,status,error);
 const data=value&&typeof value==='object'?value as {review?:ReasonInput[];generationContract?:string}:{};
 const reasons=reviewMessages(error?[{code:error}]:data.review??[]);
 return <div><strong>{editorialLabels[state]}</strong>
  {state==='READY_TO_PUBLISH'&&<p className="muted">{data.generationContract==='direct-generation-v2'?'اكتملت الصياغة المباشرة؛ قرار الإرسال يخضع لإعدادات النشر':'اجتازت المادة التحقق التحريري؛ قرار الإرسال مستقل ويخضع لإعدادات النشر'}</p>}
  {state==='PROCESSING_ERROR'?<p>{technicalExplanation}</p>:state==='NEEDS_REVIEW'&&<ul>{(reasons.length?reasons:['يتطلب الخبر مراجعة تحريرية إضافية']).map(r=><li key={r}>{r}</li>)}</ul>}
 </div>;
}
