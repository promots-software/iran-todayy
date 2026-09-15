import Link from "next/link";
import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { date, label } from "@/lib/labels";
import { PageTitle, DatabaseNotice, Badge, EmptyState, SourceLink } from "@/components/ui";
import { NewsFeed } from "@/components/news-feed";
export default async function FilteredPage() {
  const result = await readDatabase(() => db.sourcePost.findMany({ where: { status: { in: ["FILTERED", "REJECTED", "DUPLICATE"] } }, include: { source: true, matches: { include: { eventRevision: { include: { newsItem: true } } } } }, orderBy: { ingestedAt: "desc" }, take: 100 }));
  return <><PageTitle title="المستبعد والمرفوض" description="المنشورات المستبعدة والمكررة مع توضيح السبب وعلاقتها بالحدث." /><section className="panel"><h2>منشورات المصادر</h2>{!result.available ? <DatabaseNotice /> : !result.data.length ? <EmptyState title="لا توجد منشورات مستبعدة" /> : result.data.map(post => <article key={post.id} className="news-row"><div className="section-title"><strong>{post.source.name}</strong><Badge value={post.status} /></div><p className="original" dir="auto">{post.originalContent}</p><p>{post.rejectionReason ?? "لم يُسجّل سبب"}</p><div className="row-meta"><span>اللغة: {post.originalLanguage ?? "غير محددة"}</span><span>{date(post.sourcePublishedAt)}</span><SourceLink url={post.sourceUrl} /><Link className="text-link" href={`/posts/${post.id}`}>سجل المعالجة ←</Link></div>{post.matches.map(match => <p key={match.id}>{label(match.classification)} · {match.rationale} · {match.eventRevision.newsItem ? <Link className="text-link" href={`/news/${match.eventRevision.newsItem.id}`}>الحدث {match.eventRevision.eventId.slice(-8)}</Link> : <span>الحدث {match.eventRevision.eventId}</span>}</p>)}</article>)}</section><section className="panel"><h2>أخبار مرفوضة أو مستبعدة</h2><NewsFeed where={{ status: { in: ["REJECTED", "FILTERED", "DUPLICATE"] } }} /></section></>;
}
