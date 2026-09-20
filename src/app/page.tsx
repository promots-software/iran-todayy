import type {PageProps} from '@/lib/dashboard-pagination';
import {requireUser} from '@/lib/session';
import {PageTitle,DatabaseNotice} from '@/components/ui';
import {NewsFeed} from '@/components/news-feed';
import {overview} from '@/lib/queries';
export default async function OverviewPage({searchParams}:PageProps){await requireUser();const params=await searchParams;const r=await overview();return <><PageTitle title="نظرة عامة" description="متابعة وصول الأخبار وحالتها — للقراءة فقط"/>{!r.available&&<DatabaseNotice/>}<section className="stats">{[['المصادر المفعلة',r.data?.sources],['الأخبار',r.data?.items],['بانتظار المراجعة',r.data?.pending],['المنشورات',r.data?.published]].map(([label,n])=><div className="stat" key={label}><span>{label}</span><strong>{n??'—'}</strong></div>)}</section><h2>آخر الأخبار</h2><NewsFeed params={params}/></>;}
