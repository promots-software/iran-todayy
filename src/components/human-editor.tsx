'use client';
import Image from 'next/image';
import {useActionState,useId,useRef,useState} from 'react';
import {saveHumanDraftAction,approveHumanDraftAction,uploadPublicationImage} from '@/app/actions';
import {renderPublicationText} from '@/lib/publication-text';
export function HumanEditor({kind,id,revision,title,body,draftId,digest,status,locked,publicationImageId}:{kind:'post'|'news';id:string;revision:number;title:string;body:string;draftId?:string;digest?:string;status?:string;locked:boolean;publicationImageId?:string|null}){
 const [saved,save,pending]=useActionState(saveHumanDraftAction,{ok:false,message:''});
 const [approved,approve,approving]=useActionState(approveHumanDraftAction,{ok:false,message:''});
 const [media,setMedia]=useState(publicationImageId??'');
 const [editedTitle,setTitle]=useState(title),[editedBody,setBody]=useState(body);
 const [uploaded,upload,uploading]=useActionState(uploadPublicationImage,{ok:false,message:''});
 const formId=useId(),dialog=useRef<HTMLDialogElement>(null);
 const selected=uploaded.imageId&&media!==`removed:${uploaded.imageId}`?uploaded.imageId:media.startsWith('removed:')?'':media;
 const dirty=editedTitle!==title||editedBody!==body||selected!==(publicationImageId??'');
 return <section className="panel form-panel"><h2>تحرير الخبر</h2>
 {locked?<p>هذا الخبر مقفل بعد بدء النشر.</p>:<>
 <label>العنوان العربي<input form={formId} name="title" value={editedTitle} onChange={e=>setTitle(e.target.value)} required maxLength={4096}/></label>
 <label>النص العربي <span className="muted">(اختياري للخبر العاجل المكتمل في العنوان)</span><textarea form={formId} name="body" value={editedBody} onChange={e=>setBody(e.target.value)} maxLength={4096} rows={10}/></label>
 <div><h3>صورة النشر <span className="muted">(اختيارية)</span></h3>
 <form action={upload}><label>اختيار صورة<input type="file" name="image" accept="image/png,image/jpeg" required/></label><button className="secondary" disabled={uploading||pending}>{selected?'تغيير الصورة':'إضافة صورة'}</button>{uploaded.message&&<p role="status">{uploaded.ok?'تم اختيار الصورة.':uploaded.message}</p>}</form>
 {selected&&<div><Image unoptimized width={800} height={450} className="media-preview" src={`/media/${selected}`} alt="صورة النشر الاختيارية"/><button type="button" className="secondary" onClick={()=>setMedia(`removed:${uploaded.imageId??''}`)}>إزالة الصورة</button></div>}
 <label key={selected}><input form={formId} type="radio" name="mediaDecision" value="on" required/> {selected?'استخدام هذه الصورة':'النشر دون صورة'}</label>
 </div>
 <form id={formId} action={save}>
 <input type="hidden" name="publicationImageId" value={selected}/><input type="hidden" name="kind" value={kind}/><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={revision}/>
 <div className="controls"><button disabled={pending||uploading}>حفظ التعديلات</button><button type="button" disabled={!draftId||status!=='DRAFT'||dirty||pending||uploading} onClick={()=>dialog.current?.showModal()}>اعتماد الخبر</button></div>
 {dirty&&<p className="muted">احفظ التعديلات قبل الاعتماد.</p>}{status==='APPROVED'&&!dirty&&<p role="status">الخبر معتمد.</p>}{saved.message&&<p role="status">{saved.ok?'تم حفظ التعديلات.':saved.message}</p>}
 </form>
 {draftId&&status==='DRAFT'&&<dialog ref={dialog}><h2>اعتماد الخبر</h2><p className="original">{renderPublicationText(title,body)}</p><form action={approve} className="form-panel">
 <input type="hidden" name="draftId" value={draftId}/><input type="hidden" name="digest" value={digest}/>
 <label>ملاحظة المراجعة<textarea name="note" required minLength={20} maxLength={5000} placeholder="دوّن ما راجعته وأي تصحيح أجريته"/></label>
 <label><input name="confirmHuman" type="checkbox" required/> راجعت المصدر والنص وأتحمل مسؤولية اعتماد الخبر.</label>
 <div className="controls"><button disabled={approving}>تأكيد الاعتماد</button><button type="button" className="secondary" onClick={()=>dialog.current?.close()}>إلغاء</button></div>{approved.message&&<p role="status">{approved.message}</p>}
 </form></dialog>}
 </>}
 </section>;
}
