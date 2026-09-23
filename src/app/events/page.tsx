import Link from 'next/link';
import {IngestionSource} from '@/components/ingestion-source';
import {pageNumber,type PageProps} from '@/lib/dashboard-pagination';
import {duplicatePage} from '@/lib/processing-visibility';
import {Pagination} from '@/components/pagination';
import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {PageTitle,DatabaseNotice,EmptyState} from '@/components/ui';
import {NewsCard} from '@/components/news-card';
export default async function EventsPage({searchParams}:PageProps){
 await requireUser(true);const params=await searchParams;const r=await readDatabase(()=>duplicatePage(db,pageNumber(params.page)));
 return <><PageTitle title="الأخبار المكررة" description="تطابقات مؤكدة محفوظة — لا يعاد نشرها"/><p><Link href="/processing?state=technical">حالات المطابقة غير المحسومة والتعثر التقني في سجل المعالجة</Link></p>{!r.available?<DatabaseNotice/>:!r.data.items.length?<EmptyState/>:r.data.items.map(m=><NewsCard key={m.id} title={m.sourcePost.originalContent.slice(0,180)} source={<IngestionSource posts={[m.sourcePost]}/>} time={m.createdAt} status="DUPLICATE" reason={`الخبر الأصلي: ${m.eventRevision.event.title} — ${m.rationale}`} actions={<><Link href={`/posts/${m.sourcePostId}`}>تفاصيل المنشور المكرر</Link>{m.eventRevision.newsItem?<Link href={`/news/${m.eventRevision.newsItem.id}`}>الخبر الأصلي المطابق</Link>:<span>الحدث: <bdi>{m.eventRevision.eventId}</bdi></span>}</>}/>)}{r.available&&<Pagination {...r.data} path="/events" params={params} pageKey="page" label="الأخبار"/>}</>;
}
