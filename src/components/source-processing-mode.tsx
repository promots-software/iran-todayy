"use client";
import {useActionState,useState} from 'react';
import {sourceProcessingModeAction} from '@/app/actions';
export function SourceProcessingModeControl({value="NORMAL"}:{value?:"NORMAL"|"DIRECT"}) {
 const [mode,setMode]=useState(value);
 return <><label>طريقة المعالجة<select name="processingMode" value={mode} onChange={e=>setMode(e.target.value as "NORMAL"|"DIRECT")}><option value="NORMAL">المعالجة العادية</option><option value="DIRECT">المعالجة المباشرة</option></select></label><p className="muted small">{mode==="DIRECT"?"يُعتبر محتوى المصدر ضمن نطاق المشروع؛ تبقى مراجعة الأدلة والصياغة والسلامة مطلوبة.":"يُفحص نطاق الخبر وصلته بالموضوع قبل استكمال المعالجة التحريرية."}</p></>;
}
export function SourceProcessingModeForm({id,value}:{id:string;value:"NORMAL"|"DIRECT"}) {
 const [state,action,pending]=useActionState(sourceProcessingModeAction,{ok:false,message:""});
 return <form action={action} className="form-panel"><input type="hidden" name="id" value={id}/><SourceProcessingModeControl value={value}/><button disabled={pending}>حفظ طريقة المعالجة</button>{state.message&&<p role="status">{state.message}</p>}</form>;
}
