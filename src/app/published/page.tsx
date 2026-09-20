import {pageNumber,pageWindow,type PageProps} from '@/lib/dashboard-pagination';
import {Pagination} from '@/components/pagination';
import Image from 'next/image';
import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {PageTitle,DatabaseNotice,EmptyState} from '@/components/ui';
import {NewsCard} from '@/components/news-card';
export default async function PublishedPage({searchParams}:PageProps){await requireUser();const params=await searchParams;const r=await readDatabase(()=>db.$transaction(async tx=>{const paging=pageWindow(pageNumber(params.page),await tx.publication.count({where:{status:'SENT'}}));const items=await tx.publication.findMany({where:{status:'SENT'},orderBy:[{sentAt:'desc'},{id:'desc'}],skip:paging.skip,take:paging.take});return {items,...paging};},{isolationLevel:'RepeatableRead'}));return <><PageTitle title="الأخبار المنشورة" description="المحتوى المجمد المنشور على الويب أو المرسل إلى Telegram — للقراءة فقط"/>{!r.available?<DatabaseNotice/>:!r.data.items.length?<EmptyState/>:r.data.items.map(p=><section key={p.id}><NewsCard title={p.contentSnapshot.split('\n')[0]} body={p.contentSnapshot.split('\n').slice(1).join('\n')} source={p.destination==='WEB'?'الويب':`Telegram · ${p.telegramMessageId??'—'}`} status="PUBLISHED" time={p.sentAt??p.createdAt}/>{p.publicationImageId&&<Image unoptimized width={800} height={450} className="media-preview" src={`/media/${p.publicationImageId}`} alt="صورة النشر"/>}</section>)}{r.available&&<Pagination {...r.data} path="/published" params={params} pageKey="page" label="الأخبار"/>}</>;}
