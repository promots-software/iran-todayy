'use client';
import {useRouter} from 'next/navigation';
import {useEffect,useState} from 'react';
export function OperationsRefresh(){const router=useRouter(),[active,setActive]=useState(false);useEffect(()=>{if(!active)return;const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!document.querySelector('details[open]'))router.refresh();},60000);return()=>clearInterval(timer);},[active,router]);return <label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> تحديث كل دقيقة أثناء عرض الصفحة؛ يتوقف عند فتح عنصر تحكم</label>;}
