import {pageNumber,pageWindow,type PageProps} from '@/lib/dashboard-pagination';
import {Pagination} from '@/components/pagination';
import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {PageTitle,DatabaseNotice,EmptyState} from '@/components/ui';
import {NewsCard} from '@/components/news-card';
export default async function FilteredPage({searchParams}:PageProps){await requireUser(true);const params=await searchParams;const r=await readDatabase(()=>db.$transaction(async tx=>{const paging=pageWindow(pageNumber(params.page),await tx.sourcePost.count({where:{status:{in:['FILTERED','REJECTED']}}}));const items=await tx.sourcePost.findMany({where:{status:{in:['FILTERED','REJECTED']}},include:{source:true},skip:paging.skip,take:paging.take,orderBy:[{ingestedAt:'desc'},{id:'desc'}]});return {items,...paging};},{isolationLevel:'RepeatableRead'}));return <><PageTitle title="المستبعد والمرفوض" description="سجل محفوظ للقراءة فقط؛ المصدر والأدلة لا تحذف"/>{!r.available?<DatabaseNotice/>:!r.data.items.length?<EmptyState/>:r.data.items.map(p=><NewsCard key={p.id} title={p.originalContent.slice(0,180)} body={p.originalContent} source={p.source.name} status={p.status} time={p.ingestedAt} reason={p.rejectionReason??undefined}/>)}{r.available&&<Pagination {...r.data} path="/filtered" params={params} pageKey="page" label="الأخبار"/>}</>;}
