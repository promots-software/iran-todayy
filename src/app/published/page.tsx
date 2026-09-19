import Image from 'next/image';
import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {PageTitle,DatabaseNotice,EmptyState} from '@/components/ui';
import {NewsCard} from '@/components/news-card';
export default async function PublishedPage(){await requireUser();const r=await readDatabase(()=>db.publication.findMany({where:{status:'SENT'},orderBy:{sentAt:'desc'},take:100}));return <><PageTitle title="الأخبار المنشورة" description="المحتوى المجمد المنشور على الويب أو المرسل إلى Telegram — للقراءة فقط"/>{!r.available?<DatabaseNotice/>:!r.data.length?<EmptyState/>:r.data.map(p=><section key={p.id}><NewsCard title={p.contentSnapshot.split('\n')[0]} body={p.contentSnapshot.split('\n').slice(1).join('\n')} source={p.destination==='WEB'?'الويب':`Telegram · ${p.telegramMessageId??'—'}`} status="PUBLISHED" time={p.sentAt??p.createdAt}/>{p.publicationImageId&&<Image unoptimized width={800} height={450} className="media-preview" src={`/media/${p.publicationImageId}`} alt="صورة النشر"/>}</section>)}</>;}
