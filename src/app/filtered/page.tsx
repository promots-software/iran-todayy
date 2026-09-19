import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {PageTitle,DatabaseNotice,EmptyState} from '@/components/ui';
import {NewsCard} from '@/components/news-card';
export default async function FilteredPage(){await requireUser(true);const r=await readDatabase(()=>db.sourcePost.findMany({where:{status:{in:['FILTERED','REJECTED']}},include:{source:true},take:100,orderBy:{ingestedAt:'desc'}}));return <><PageTitle title="المستبعد والمرفوض" description="سجل محفوظ للقراءة فقط؛ المصدر والأدلة لا تحذف"/>{!r.available?<DatabaseNotice/>:!r.data.length?<EmptyState/>:r.data.map(p=><NewsCard key={p.id} title={p.originalContent.slice(0,180)} body={p.originalContent} source={p.source.name} status={p.status} time={p.ingestedAt} reason={p.rejectionReason??undefined}/>)}</>;}
