'use client';
import {useActionState,useState} from 'react';
import {operationAction} from '@/app/operations/actions';
export function PublishingModeForm({automatic,canEnable,canDisable,expected,requestId}:{automatic:boolean;canEnable:boolean;canDisable:boolean;expected:string;requestId:string}){
 const [selection,setSelection]=useState({expected,value:String(automatic)});
 const selected=selection.expected===expected?selection.value:String(automatic);
 const setSelected=(value:string)=>setSelection({expected,value});
 const [state,action,pending]=useActionState(operationAction,{ok:false,message:''});
 const changed=selected!==String(automatic);
 return <form action={action}>
 <fieldset disabled={pending}><legend>حالة النشر</legend>
 <label><input type="radio" name="value" value="true" checked={selected==='true'} disabled={!automatic&&!canEnable} onChange={()=>setSelected('true')}/> النشر التلقائي</label>
 <label><input type="radio" name="value" value="false" checked={selected==='false'} disabled={automatic&&!canDisable} onChange={()=>setSelected('false')}/> النشر اليدوي</label>
 </fieldset>
 {Object.entries({kind:'AUTO_PUBLISH',target:'1',expected,requestId}).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
 <label><input key={expected+selected} type="checkbox" name="confirmed" required disabled={!changed||pending}/> أؤكد تغيير حالة النشر</label>
 <button disabled={!changed||pending}>حفظ الإعدادات</button>
 <p role="status">{state.ok?'حُفظ الوضع المطلوب. راجع تأكيد الناشر والحالة الفعلية أعلاه.':state.message}</p>
 </form>;
}
