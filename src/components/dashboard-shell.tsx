'use client';
import {useEffect,useState,useSyncExternalStore,useRef} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {logoutAction} from '@/app/login/actions';
import {allowed,roleLabel,type Role} from '@/lib/dashboard-permissions';
const subscribe=(listener:()=>void)=>{window.addEventListener('storage',listener);window.addEventListener('themechange',listener);return()=>{window.removeEventListener('storage',listener);window.removeEventListener('themechange',listener);};};
const snapshot=()=>localStorage.getItem('theme')??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
const routes=[['/','نظرة عامة'],['/sources','المصادر'],['/monitoring','رصد'],['/approvals','الموافقات'],['/review','المراجعات'],['/published','الأخبار المنشورة'],['/filtered','المستبعد والمرفوض'],['/events','الأخبار المكررة'],['/processing','سجل المعالجة'],['/logs','سجل العمليات'],['/settings','الإعدادات'],['/system','حالة النظام'],['/operations','مركز العمليات']];
export function DashboardShell({user,children}:{user:{displayName:string;role:Role}|null;children:React.ReactNode}){
 const path=usePathname(),[open,setOpen]=useState(false);
 const drawer=useRef<HTMLElement>(null),menuButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;const controls=()=>Array.from(drawer.current?.querySelectorAll<HTMLElement>('a,button')??[]).filter(e=>e.offsetParent!==null);controls()[0]?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);menuButton.current?.focus();}if(e.key==='Tab'){const items=controls(),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[open]);
 const selectedTheme=useSyncExternalStore(subscribe,snapshot,()=> 'light');const dark=selectedTheme==='dark';
 useEffect(()=>{document.documentElement.dataset.theme=selectedTheme;},[selectedTheme]);
 useEffect(()=>{const onShow=(e:PageTransitionEvent)=>{if(e.persisted)location.reload();};window.addEventListener('pageshow',onShow);return()=>window.removeEventListener('pageshow',onShow);},[]);
 function theme(){const d=!dark;localStorage.setItem('theme',d?'dark':'light');window.dispatchEvent(new Event('themechange'));document.documentElement.dataset.theme=d?'dark':'light';}
 const control=<button type="button" className="secondary" onClick={theme} aria-label="تبديل المظهر">{dark?'المظهر الفاتح':'المظهر الداكن'}</button>;
 if(!user||path==='/login')return <>{control}{children}</>;
 return <div className="app-shell"><a className="skip" href="#main">انتقل إلى المحتوى</a>{open&&<button className="drawer-backdrop" aria-label="إغلاق القائمة" onClick={()=>setOpen(false)}/>}
 <aside ref={drawer} id="navigation" className={`sidebar ${open?'drawer-open':''}`}><div className="brand"><strong>منصة إيران الآن</strong></div><button className="mobile-only secondary" onClick={()=>setOpen(false)}>إغلاق القائمة</button><nav aria-label="القائمة الرئيسية">{routes.filter(([href])=>allowed(user.role,href)).map(([href,label])=><Link onClick={()=>setOpen(false)} className={`nav-link ${path===href?'active':''}`} aria-current={path===href?'page':undefined} href={href} key={href}>{label}</Link>)}</nav><form className="logout" action={logoutAction}><button className="secondary">تسجيل الخروج</button></form></aside>
 <div className="workspace"><header className="topbar"><button ref={menuButton} className="mobile-only secondary" aria-controls="navigation" aria-expanded={open} onClick={()=>setOpen(!open)}>القائمة</button><span className="topbar-note"><span className="avatar">{user.displayName.slice(0,1)}</span>{user.displayName} · {roleLabel(user.role)}</span>{control}</header><main id="main">{children}</main><footer>منصة إيران الآن · جميع الأوقات بتوقيت بيروت</footer></div></div>;
}
