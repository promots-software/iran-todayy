import Link from 'next/link';
import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {outcomePage,outcomeFilters} from '@/lib/processing-visibility';
import {pageNumber,type PageProps} from '@/lib/dashboard-pagination';
import {Pagination} from '@/components/pagination';
import {IngestionSource} from '@/components/ingestion-source';
import {PageTitle,DatabaseNotice,EmptyState,Badge} from '@/components/ui';
import {date,label} from '@/lib/labels';
const labels={all:'كل الأخبار الحالية',processing:'قيد المعالجة',technical:'تعثر أو انتظار تقني',duplicate:'مكرر',review:'يحتاج مراجعة',ready:'بانتظار النشر',rejected:'مستبعد أو مرفوض',published:'منشور',historical:'أرشيف ملغى بسبب الاستيراد التاريخي'};
export default async function ProcessingPage({searchParams}:PageProps){
 await requireUser(true);const params=await searchParams;const r=await readDatabase(()=>outcomePage(db,params,pageNumber(params.page)));
 return <><PageTitle title="سجل المعالجة" description="كل خبر وارد ونتيجته المحفوظة. عرض فقط؛ لا تُعاد المعالجة عند فتح الصفحة."/>{!r.available?<DatabaseNotice/>:<><form className="filters"><label>المصدر<select name="source" defaultValue={typeof params.source==='string'?params.source:''}><option value="">جميع المصادر</option>{r.data.sources.map(s=><option key={s.id} value={s.id}>{s.name} — {s.handle}</option>)}</select></label><label>النتيجة<select name="state" defaultValue={typeof params.state==='string'?params.state:'all'}>{outcomeFilters.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label><button>تصفية</button></form>{!r.data.items.length?<EmptyState/>:r.data.items.map(p=><article className="panel" key={p.id}><div className="section-title"><Badge value={p.status}/><time>{date(p.ingestedAt)}</time></div><h3>{p.originalContent.slice(0,180)||'منشور بلا نص'}</h3><IngestionSource posts={[p]}/><p><bdi>{p.id} · {p.sourcePostId}</bdi></p>{(p.error||p.rejectionReason)&&<p>السبب: <bdi>{label(p.rejectionReason??p.error!)}</bdi></p>}{p.jobs.map(j=><p key={j.id}>المهمة: <Badge value={j.status}/> · <bdi>{j.id}</bdi> · المحاولات: {j.attemptCount}{j.lastError&&<> · <bdi>{j.lastError}</bdi></>}{j.status==='RETRY'&&<> · موعد المحاولة: {date(j.availableAt)}</>}</p>)}{!p.jobs.length&&<p>لا توجد مهمة معالجة مسجلة لهذا المنشور.</p>}{p.matches.map(m=><p key={m.id}><Badge value={m.classification}/> · {m.rationale} · الحدث: <bdi>{m.eventRevision.eventId}</bdi>{m.eventRevision.newsItem&&<> · <Link href={`/news/${m.eventRevision.newsItem.id}`}>الخبر المطابق</Link></>}</p>)}{p.evidence.map(e=><p key={e.newsItem.id}><Link href={`/news/${e.newsItem.id}`}>الخبر الناتج</Link> · <Badge value={e.newsItem.status}/>{e.newsItem.publication&&<> · <Badge value={e.newsItem.publication.status}/></>}</p>)}<Link href={`/posts/${p.id}`}>المصدر والتفاصيل المحفوظة</Link></article>)}<Pagination {...r.data} path="/processing" params={params} pageKey="page" label="المنشورات"/></>}</>;
}
