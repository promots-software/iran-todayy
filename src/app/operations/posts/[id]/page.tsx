import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireSuperAdmin} from '@/lib/session';
import {db} from '@/lib/db';
import {record,safeCode} from '@/lib/operations';
import {date} from '@/lib/labels';
import {PageTitle,Badge} from '@/components/ui';
export default async function Inspector({params}:{params:Promise<{id:string}>}){
 await requireSuperAdmin();const {id}=await params;const post=await db.sourcePost.findUnique({where:{id},include:{source:true,jobs:true,evidence:{include:{newsItem:{include:{publication:true}}}}}});if(!post)notFound();
 const logs=await db.auditLog.findMany({where:{entityType:'SourcePost',entityId:id},orderBy:[{createdAt:'asc'},{id:'asc'}],take:300});
 return <><PageTitle title="مفتش مسار الخبر" description={post.source.name}/><p><Link href={`/posts/${id}`}>فتح الأصل والمراجعة</Link></p><section className="panel"><p>نشر المصدر: {date(post.sourcePublishedAt)} · الحفظ: {date(post.ingestedAt)}</p><p>طريقة المصدر الآن: {post.source.processingMode} · طريقة النتيجة: {String(record(post.processingResult).processingMode??record(post.relevanceResult).processingMode??'غير مسجلة')}</p><Badge value={post.status}/><p>{post.error?safeCode(post.error):'لا خطأ مسجل'}</p><p>توقيت مراحل الإنهاء القديم قد يكون توقيت تسجيل مجمع؛ لا يُفسر كزمن مستقل لكل مرحلة.</p></section><section className="panel"><h2>آخر 300 حدث متاح حسب ترتيب التسجيل</h2>{logs.map(l=>{const m=record(l.metadata);return <article key={l.id}><bdi>{safeCode(l.action)}</bdi> · {date(l.createdAt)}<p>{typeof m.stage==='string'?m.stage:''} · {typeof m.durationMs==='number'?`${m.durationMs} ms`:'المدة غير مسجلة'} · {m.code?safeCode(m.code):''}</p></article>;})}</section><section className="panel"><h2>النتيجة والنشر</h2>{post.evidence.map(e=><p key={e.newsItemId}><Link href={`/news/${e.newsItemId}`}>{e.newsItem.title}</Link> · <Badge value={e.newsItem.status}/> · {e.newsItem.publication?`${e.newsItem.publication.destination} / ${e.newsItem.publication.status} / message_id ${e.newsItem.publication.telegramMessageId??'غير مسجل'}`:'لا سجل نشر'}</p>)}</section></>;
}
