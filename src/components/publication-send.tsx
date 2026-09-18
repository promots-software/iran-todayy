"use client";
import {useActionState} from 'react';
import {publishPublicationAction} from '@/app/actions';
export function PublicationSend({id,digest,destination,content,enabled}:{id:string;digest:string;destination:string;content:string;enabled:boolean}){
 const [state,action,pending]=useActionState(publishPublicationAction,{ok:false,message:''});
 return <section className="panel"><h2>نشر الرسالة المعتمدة</h2>
  <p>الوجهة: <bdi>{destination}</bdi></p><p className="original">{content}</p>
  {enabled?<form action={action} className="form-panel">
   <input type="hidden" name="publicationId" value={id}/><input type="hidden" name="digest" value={digest}/><input type="hidden" name="destination" value={destination}/>
   <label><input type="checkbox" name="confirmSend" required/> أؤكد إرسال النص المعتمد أعلاه إلى هذه القناة الآن.</label>
   <button disabled={pending||state.ok}>{pending?'جارٍ الإرسال…':'نشر مرة واحدة على Telegram'}</button>
   {state.message&&<p role="status">{state.message}</p>}
  </form>:<p>النشر اليدوي غير مهيأ. يلزم إعداد الناشر على خادم لوحة التحكم.</p>}
 </section>;
}
