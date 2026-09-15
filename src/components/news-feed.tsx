import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { date } from "@/lib/labels";
import { Badge, DatabaseNotice, EmptyState } from "./ui";

export async function NewsFeed({ where = {} }: { where?: Prisma.NewsItemWhereInput }) {
  const result = await readDatabase(() => db.newsItem.findMany({ where, take: 100, orderBy: { createdAt: "desc" }, include: { eventRevision: { include: { event: true } }, evidence: { include: { sourcePost: { include: { source: true } } } } } }));
  if (!result.available) return <DatabaseNotice />;
  if (!result.data.length) return <EmptyState />;
  return <div>{result.data.map(item => <article className="news-row" key={item.id}>
    <div className="section-title"><Badge value={item.status} /><time>{date(item.createdAt)}</time></div>
    <h3><Link href={`/news/${item.id}`}>{item.title}</Link></h3>
    <p className="excerpt">{item.arabicContent ?? "لم تُنتج الصياغة العربية بعد"}</p>
    <div className="row-meta"><span>{[...new Set(item.evidence.map(e => e.sourcePost.source.name))].join(" · ") || "لم يُربط مصدر بعد"}</span><span>حدث {item.eventRevision.event.id.slice(-8)} / إصدار {item.eventRevision.revision}</span><Link className="text-link" href={`/news/${item.id}`}>تفاصيل الخبر ←</Link></div>
  </article>)}<p className="muted small">أحدث ١٠٠ خبر بحسب وقت الإنشاء.</p></div>;
}
