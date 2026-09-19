import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {PageTitle,DatabaseNotice,EmptyState} from '@/components/ui';
import {NewsCard} from '@/components/news-card';
export default async function EventsPage(){await requireUser(true);const r=await readDatabase(()=>db.eventMatch.findMany({where:{classification:'DUPLICATE'},include:{sourcePost:{include:{source:true}},eventRevision:{include:{event:true}}},take:100,orderBy:{createdAt:'desc'}}));return <><PageTitle title="الأخبار المكررة" description="مواد مرتبطة بأخبار سابقة — للقراءة فقط"/>{!r.available?<DatabaseNotice/>:!r.data.length?<EmptyState/>:r.data.map(m=><NewsCard key={m.id} title={m.sourcePost.originalContent.slice(0,180)} source={m.sourcePost.source.name} time={m.createdAt} status="DUPLICATE" reason={`الخبر الأصلي: ${m.eventRevision.event.title}`}/>)}</>;}
