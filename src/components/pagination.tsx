import Link from 'next/link';
import {pageHref,type PageParams} from '@/lib/dashboard-pagination';
export function Pagination({page,pages,total,path,params,pageKey,label}:{page:number;pages:number;total:number;path:string;params:PageParams;pageKey:string;label:string}){
 if(!total)return null;
 return <nav className="controls" aria-label={label}><span>{label} · {total.toLocaleString('ar')} · الصفحة {page.toLocaleString('ar')} من {pages.toLocaleString('ar')}</span>{page>1&&<Link className="text-link" href={pageHref(path,params,pageKey,page-1)}>السابق</Link>}{page<pages&&<Link className="text-link" href={pageHref(path,params,pageKey,page+1)}>التالي</Link>}</nav>;
}
