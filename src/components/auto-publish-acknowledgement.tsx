'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
/** Only refreshes server reads. Never repeats the mutation or a publication. */
export function AutoPublishAcknowledgement({policyKey,awaiting}:{policyKey:string;awaiting:boolean}){
 const router=useRouter();const [exhausted,setExhausted]=useState<string|null>(null);
 useEffect(()=>{
  if(!awaiting)return;
  let attempts=0;
  const timer=setInterval(()=>{
   if(++attempts>6){clearInterval(timer);setExhausted(policyKey);return;}
   router.refresh();
  },5000);
  return()=>clearInterval(timer);
 },[awaiting,policyKey,router]);
 return <div aria-live="polite">{awaiting&&<p>{exhausted===policyKey?'لم يصل تأكيد الناشر خلال المهلة؛ تحقق من الحالة قبل الاعتماد عليها.':'جارٍ انتظار تأكيد الناشر؛ تُحدّث الحالة تلقائياً.'}</p>}<button type="button" className="secondary" onClick={()=>router.refresh()}>تحديث حالة الناشر</button></div>;
}
