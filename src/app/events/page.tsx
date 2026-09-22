import {IngestionSource} from '@/components/ingestion-source';
import {pageNumber,pageWindow,type PageProps} from '@/lib/dashboard-pagination';
import {Pagination} from '@/components/pagination';
import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {PageTitle,DatabaseNotice,EmptyState} from '@/components/ui';
import {NewsCard} from '@/components/news-card';
export default async function EventsPage({searchParams}:PageProps){await requireUser(true);const params=await searchParams;const r=await readDatabase(()=>db.$transaction(async tx=>{const paging=pageWindow(pageNumber(params.page),await tx.eventMatch.count({where:{classification:'DUPLICATE'}}));const items=await tx.eventMatch.findMany({where:{classification:'DUPLICATE'},include:{sourcePost:{include:{source:true}},eventRevision:{include:{event:true}}},skip:paging.skip,take:paging.take,orderBy:[{createdAt:'desc'},{id:'desc'}]});return {items,...paging};},{isolationLevel:'RepeatableRead'}));return <><PageTitle title="الأخبار المكررة" description="مواد مرتبطة بأخبار سابقة — للقراءة فقط"/>{!r.available?<DatabaseNotice/>:!r.data.items.length?<EmptyState/>:r.data.items.map(m=><NewsCard key={m.id} title={m.sourcePost.originalContent.slice(0,180)} source={<IngestionSource posts={[m.sourcePost]}/>} time={m.createdAt} status="DUPLICATE" reason={`الخبر الأصلي: ${m.eventRevision.event.title}`}/>)}{r.available&&<Pagination {...r.data} path="/events" params={params} pageKey="page" label="الأخبار"/>}</>;}
