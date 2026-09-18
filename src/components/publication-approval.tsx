'use client';
import {useActionState} from 'react';
import {approvePublicationAction} from '@/app/actions';
export function PublicationApproval({id,digest,reviews}:{id:string;digest:string;reviews:{key:string;label:string}[]}){
 const [state,action,pending]=useActionState(approvePublicationAction,{ok:false,message:''});
 return <form action={action} className="panel form-panel">
  <h2>المراجعة والاعتماد اليدوي</h2>
  <p>راجع النص والأدلة أعلاه. الاعتماد يحفظ هذا المحتوى تحديداً ولا يرسل رسالة.</p>
  <input type="hidden" name="id" value={id}/><input type="hidden" name="digest" value={digest}/>
  {reviews.map((r,i)=><label key={r.key}>{r.label}<input type="hidden" name="reviewKey" value={r.key}/><textarea name={`resolution-${i}`} required minLength={10} maxLength={3000} placeholder="وثّق نتيجة المراجعة والدليل أو قرار المحرر"/></label>)}
  <label><input type="checkbox" name="confirm" required/> راجعت المحتوى والأدلة وأوافق يدوياً على النص المعروض.</label>
  <button disabled={pending}>{pending?'جارٍ الحفظ…':'اعتماد النص دون إرسال'}</button>
  {state.message&&<p role="status">{state.message}</p>}
 </form>;
}
