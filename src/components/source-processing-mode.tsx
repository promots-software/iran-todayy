"use client";
import {useActionState} from 'react';
import {sourceProcessingModeAction} from '@/app/actions';
export function SourceProcessingModeControl({value="NORMAL"}:{value?:"NORMAL"|"DIRECT"}) {
 return <><label>طريقة المعالجة<select name="processingMode" defaultValue={value}><option value="NORMAL">المعالجة العادية</option><option value="DIRECT">المعالجة المباشرة</option></select></label><p className="muted small">يُعتبر كل محتوى هذا المصدر ضمن نطاق المشروع، ويُعاد تحريره أو ترجمته مباشرة دون فحص الصلة بالموضوع.</p></>;
}
export function SourceProcessingModeForm({id,value}:{id:string;value:"NORMAL"|"DIRECT"}) {
 const [state,action,pending]=useActionState(sourceProcessingModeAction,{ok:false,message:""});
 return <form action={action} className="form-panel"><input type="hidden" name="id" value={id}/><SourceProcessingModeControl value={value}/><button disabled={pending}>حفظ طريقة المعالجة</button>{state.message&&<p role="status">{state.message}</p>}</form>;
}
