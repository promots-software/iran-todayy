import {requireUser} from "@/lib/session";
import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { workerIsStale } from "@/lib/domain";
import { date } from "@/lib/labels";
import { PageTitle, DatabaseNotice, Badge } from "@/components/ui";
export default async function SystemPage() {
 await requireUser(true);
  const result = await readDatabase(async () => {
    const [workers, jobs] = await Promise.all([db.workerHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" } }), db.processingJob.groupBy({ by: ["status"], _count: true })]);
    return { workers, jobs };
  });
  return <><PageTitle title="حالة النظام" description="اتصال قاعدة البيانات وآخر نبضة للعامل وحالة مهام المعالجة." />{!result.available && <DatabaseNotice />}
    <section className="panel"><h2>الخدمات</h2><dl className="facts"><dt>قاعدة البيانات</dt><dd>{result.available ? "متصلة" : "غير متاحة"}</dd><dt>مراقبة Telegram وX</dt><dd>تُعرض حالة الاتصال الفعلية في نبضات العامل أدناه؛ لا يُستنتج الاتصال من فتح الصفحة</dd><dt>محرك التحرير</dt><dd>تُعرض حالات المهام أدناه؛ سلامة الصياغة تُراجع لكل خبر</dd><dt>النشر إلى Telegram</dt><dd>مسار يدوي مستقل. فتح هذه الصفحة لا يرسل أي رسالة</dd></dl></section>
    <section className="panel"><h2>العامل الخلفي</h2><p className="muted">العامل يعالج الطابور مع إعادة المحاولة. يحتاج خدمة مستقلة عن Vercel. حدّث الصفحة للحصول على أحدث حالة.</p>{result.available && !result.data.workers.length && <p>لا توجد نبضات مسجّلة. شغّل خدمة العامل.</p>}{result.data?.workers.map(worker => <article className="news-row" key={worker.id}><div className="section-title"><strong dir="ltr">{worker.id}</strong>{workerIsStale(worker.lastSeenAt, worker.intervalMs) ? <span className="badge red">النبضة متأخرة / غير متصل</span> : <Badge value={worker.state} />}</div><p>آخر نبضة: {date(worker.lastSeenAt)}</p><p className="muted">بدء التشغيل: {date(worker.startedAt)} · <bdi>{worker.phase}</bdi></p><p>جاهزية Telegram: {typeof (worker.metadata as Record<string,unknown>|null)?.telegramReady==='boolean'?((worker.metadata as Record<string,unknown>).telegramReady?'متصل':'غير جاهز'):'غير مسجلة'}</p>{worker.lastError && <p className="error-text">{worker.lastError}</p>}</article>)}</section>
    <section className="panel"><h2>مهام المعالجة</h2>{result.available && !result.data.jobs.length ? <p className="muted">لا توجد مهام معالجة.</p> : result.data?.jobs.map(job => <p key={job.status}><Badge value={job.status} /> {job._count.toLocaleString("ar")}</p>)}</section></>;
}
