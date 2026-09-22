'use client';
import {useActionState} from 'react';
import {operationAction} from '@/app/operations/actions';
export function OperationControl({kind,target,value,expected,label,requestId}:{kind:string;target:string;value:string;expected:string;label:string;requestId:string}){
 const [state,action,pending]=useActionState(operationAction,{ok:false,message:''});
 return <details><summary>{label}</summary><form action={action} className="filters">{Object.entries({kind,target,value,expected,requestId}).map(([name,v])=><input key={name} type="hidden" name={name} value={v}/>)}<label><input type="checkbox" name="confirmed" required/> أؤكد هذا التغيير: {label}</label><button disabled={pending}>تنفيذ التغيير</button><p role="status">{state.message}</p></form></details>;
}
