'use client';
import Link, {useLinkStatus} from 'next/link';

function NavigationProgress() {
 const {pending}=useLinkStatus();
 return pending ? <span role="status" aria-label="جارٍ الانتقال">…</span> : null;
}

export function SidebarLink({href,label,active,onNavigate}:{href:string;label:string;active:boolean;onNavigate:()=>void}) {
 return <Link href={href} onNavigate={onNavigate} className={`nav-link ${active?'active':''}`} aria-current={active?'page':undefined}>
  {label}<NavigationProgress/>
 </Link>;
}
