import Link from "next/link";
import { PageTitle, DatabaseNotice } from "@/components/ui";
import { NewsFeed } from "@/components/news-feed";
import { overview } from "@/lib/queries";
import { label } from "@/lib/labels";
export default async function OverviewPage() {
  const result = await overview();
  const data = result.data;
  return <><PageTitle title="نظرة عامة" description="تابع الأخبار، راجع الصياغة، وأشرف على النشر من مكان واحد." />
    <div className="notice foundation"><strong>محرك المعالجة — المرحلة الثانية</strong><span>قواعد التحرير والمطابقة جاهزة للاختبار. الموصلات الحية ومزود الذكاء الاصطناعي والإرسال الخارجي غير مفعّلة.</span><Link href="/system">حالة النظام ←</Link></div>
    {!result.available && <DatabaseNotice />}
    <section className="stats" aria-label="ملخص غرفة الأخبار">{[["المصادر المفعّلة", data?.sources, "◎"], ["الأحداث الإخبارية", data?.items, "◫"], ["بانتظار المراجعة", data?.pending, "◷"], ["الأخبار المنشورة", data?.published, "↗"]].map(([name, count, icon]) => <div className="stat" key={String(name)}><span className="stat-icon" aria-hidden="true">{icon}</span><span>{name}</span><strong>{count === undefined ? "—" : Number(count).toLocaleString("ar")}</strong></div>)}</section>
    <section className="panel"><div className="section-title"><div><h2>آخر الأخبار</h2><p className="muted small">كل حدث في سجل واحد، مع مصادره وتطوراته.</p></div><Link href="/settings" className="badge">{data ? label(data.mode) : "وضع النشر غير متاح"}</Link></div><NewsFeed /></section>
  </>;
}
