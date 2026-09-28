"use client";
import {useActionState,useId,useState,type ReactNode} from 'react';
import {sourceProcessingModeAction} from '@/app/actions';
export function SourceProcessingModeControl({value="NORMAL",action}:{value?:"NORMAL"|"DIRECT";action?:ReactNode}) {
 const [mode,setMode]=useState(value);
 const controlId=useId();
 return <div className="source-processing-control"><label htmlFor={controlId}>طريقة المعالجة</label><select id={controlId} name="processingMode" value={mode} onChange={e=>setMode(e.target.value as "NORMAL"|"DIRECT")}><option value="NORMAL">المعالجة العادية</option><option value="DIRECT">المعالجة المباشرة</option></select><p className="muted small">{mode==="DIRECT"?"يُعتبر محتوى المصدر ضمن نطاق المشروع؛ تبقى مراجعة الأدلة والصياغة والسلامة مطلوبة.":"يُفحص نطاق الخبر وصلته بالموضوع قبل استكمال المعالجة التحريرية."} طريقة المعالجة لا تحدد طريقة النشر؛ النشر التلقائي يطبّق على الخبر الجاهز من الطريقتين عند تفعيله، مع بقاء استثناءات التسليم والموافقة على التحرير البشري.</p>{action}</div>;
}
export function SourceProcessingModeForm({id,value}:{id:string;value:"NORMAL"|"DIRECT"}) {
 const [state,action,pending]=useActionState(sourceProcessingModeAction,{ok:false,message:""});
 return <form action={action} className="form-panel source-processing-form"><input type="hidden" name="id" value={id}/><SourceProcessingModeControl value={value} action={<button disabled={pending}>حفظ طريقة المعالجة</button>}/>{state.message&&<p role="status">{state.message}</p>}</form>;
}
