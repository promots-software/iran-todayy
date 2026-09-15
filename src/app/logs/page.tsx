import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { date } from "@/lib/labels";
import { PageTitle, DatabaseNotice, Badge, EmptyState, JsonView } from "@/components/ui";
export default async function LogsPage() {
  const result = await readDatabase(() => db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));
  return <><PageTitle title="سجل العمليات" description="آخر ١٠٠ عملية محفوظة للتتبع والتدقيق." /><section className="panel">{!result.available ? <DatabaseNotice /> : !result.data.length ? <EmptyState title="لم تُسجّل عمليات بعد" text="ستظهر تغييرات المصادر والإعدادات وأحداث العامل هنا." /> : result.data.map(log => <article className="news-row" key={log.id}><div className="section-title"><strong>{log.message}</strong><Badge value={log.level} /></div><p className="muted small">{date(log.createdAt)} · {log.actor} · <bdi>{log.action}</bdi></p><details><summary>تفاصيل العملية</summary><p><bdi>{log.entityType} / {log.entityId}</bdi></p><JsonView value={log.metadata} /></details></article>)}</section></>;
}
