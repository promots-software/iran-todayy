import type {PageProps} from '@/lib/dashboard-pagination';
import {requirePageAccess} from '@/lib/session';
import {PageTitle,DatabaseNotice} from '@/components/ui';
import {NewsFeed} from '@/components/news-feed';
import {OverviewStats} from '@/components/overview-stats';
import {overview} from '@/lib/queries';
export default async function OverviewPage({searchParams}:PageProps){
 await requirePageAccess('/');const params=await searchParams;const r=await overview();
 return <><PageTitle title="نظرة عامة" description="متابعة وصول الأخبار وحالتها · إحصاءات اليوم بتوقيت بيروت"/>
 {!r.available&&<DatabaseNotice/>}<OverviewStats counts={r.data}/>
 <h2>آخر الأخبار</h2><NewsFeed params={params}/></>;
}
