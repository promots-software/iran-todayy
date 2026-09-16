import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { date, label } from "@/lib/labels";
import { PageTitle, DatabaseNotice, Badge, JsonView, SourceLink } from "@/components/ui";
import { ProcessingDetails, ProcessingHistory } from "@/components/processing-details";
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await readDatabase(() => db.sourcePost.findUnique({ where: { id }, include: { source: true, jobs: true, matches: { include: { eventRevision: { include: { newsItem: true } } } } } }));
  if (!result.available) return <DatabaseNotice />;
  const post = result.data;
  if (!post) notFound();
  const logs=await readDatabase(()=>db.auditLog.findMany({where:{entityType:"SourcePost",entityId:id},orderBy:{createdAt:"asc"},take:200}));
  return <><PageTitle title={`منشور ${post.source.name}`} description={`${post.source.platform} · ${post.sourcePostId}`} /><section className="panel"><Badge value={post.status} /><p className="original" dir="auto">{post.originalContent}</p><SourceLink url={post.sourceUrl} /><dl className="facts"><dt>اللغة</dt><dd>{post.originalLanguage ?? "لم تُحدد"}</dd><dt>تاريخ المصدر</dt><dd>{date(post.sourcePublishedAt)}</dd><dt>الاستقبال</dt><dd>{date(post.ingestedAt)}</dd><dt>بداية / نهاية المعالجة</dt><dd>{date(post.processingStartedAt)} / {date(post.processingEndedAt)}</dd><dt>الصلة السياسية</dt><dd>{label(post.relevance)}</dd><dt>سبب الاستبعاد</dt><dd>{post.rejectionReason ?? "—"}</dd><dt>وضع النشر عند المعالجة</dt><dd>{label(post.modeAtProcessing)}</dd><dt>المحاولات</dt><dd>{post.retryCount}</dd><dt>المحاولة التالية</dt><dd>{date(post.nextRetryAt)}</dd><dt>الخطأ</dt><dd>{post.error ?? "—"}</dd></dl><details><summary>الاستخراج ونتيجة التقييم والمهام</summary><JsonView value={{ normalizedContent: post.normalizedContent, relevance: post.relevanceResult, jobs: post.jobs }} /></details></section><section className="panel"><h2>العلاقة بالأحداث</h2>{!post.matches.length && <p className="muted">لم يُربط بحدث بعد.</p>}{post.matches.map(match => <article className="news-row" key={match.id}><Badge value={match.classification} /><p>{match.rationale}</p><p>الحدث: <bdi>{match.eventRevision.eventId}</bdi> · الإصدار {match.eventRevision.revision}</p>{match.eventRevision.newsItem && <Link className="text-link" href={`/news/${match.eventRevision.newsItem.id}`}>الخبر المرتبط ←</Link>}<details><summary>أدلة المطابقة</summary><JsonView value={match.evidence} /></details></article>)}</section><ProcessingDetails value={post.processingResult}/><ProcessingHistory logs={logs.data??[]}/></>;
}
