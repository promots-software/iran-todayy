'use client';
import {useActionState} from 'react';
import {saveHumanDraftAction,approveHumanDraftAction} from '@/app/actions';
export function HumanEditor({kind,id,revision,title,body,draftId,digest,status,locked}:{kind:'post'|'news';id:string;revision:number;title:string;body:string;draftId?:string;digest?:string;status?:string;locked:boolean}){
 const [saved,save,pending]=useActionState(saveHumanDraftAction,{ok:false,message:''});
 const [approved,approve,approving]=useActionState(approveHumanDraftAction,{ok:false,message:''});
 return <section className="panel"><h2>التحرير البشري — {status==='APPROVED'?'معتمد بشرياً':status==='PUBLISHED'?'منشور':draftId?'محرر بشرياً':'مسودة جديدة'}</h2>
 <p>هذا مسار تحرير بشري مستقل. نتائج الذكاء الاصطناعي وأخطاؤه تبقى محفوظة ولا تتحول إلى تحقق آلي ناجح.</p>
 {locked?<p>بدأت محاولة النشر أو اكتملت. النص والسجل مقفلان لمنع التغيير أو تكرار الإرسال.</p>:<>
 <form action={save} className="form-panel">
 <input type="hidden" name="kind" value={kind}/><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={revision}/>
 <label>العنوان العربي<input name="title" defaultValue={title} required maxLength={4096}/></label>
 <label>النص العربي<textarea name="body" defaultValue={body} required maxLength={4096} rows={10}/></label>
 <p>حفظ تعديل جديد يلغي الاعتماد السابق. لا تغيّر النص بعد الحفظ دون حفظه مجدداً.</p>
 <button disabled={pending}>حفظ المسودة</button>{saved.message&&<p role="status">{saved.message}</p>}
 </form>
 {draftId&&status==='DRAFT'&&<form action={approve} className="form-panel">
 <h3>اعتماد النسخة المحفوظة — الإصدار {revision}</h3><p className="original">{title}{'\n\n'}{body}</p>
 <input type="hidden" name="draftId" value={draftId}/><input type="hidden" name="digest" value={digest}/>
 <label>توثيق المراجعة: الأدلة والنسب والأسماء والمصطلحات وأسباب تجاوز فشل المعالجة<textarea name="note" required minLength={20} maxLength={5000}/></label>
 <label><input name="confirmHuman" type="checkbox" required/> راجعت المصدر وأخطاء المعالجة وأتحمل مسؤولية صحة النص المحفوظ ونسبه وصياغته ومراجعته التحريرية. هذا اعتماد بشري وليس تحققاً آلياً.</label>
 <button disabled={approving}>اعتماد النسخة المحررة</button>{approved.message&&<p role="status">{approved.message}</p>}
 </form>}
 </>}
 </section>;
}
