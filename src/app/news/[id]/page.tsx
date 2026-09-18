import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { newsInclude, readDatabase } from "@/lib/queries";
import { date, label } from "@/lib/labels";
import { PageTitle, DatabaseNotice, Badge, JsonView, SourceLink } from "@/components/ui";
import {PublicationApproval} from '@/components/publication-approval';
import {approvalDigest,reviewKey,assertManualSendEnabled,readPublisherEnv} from '@/lib/telegram/publisher';
import {PublicationSend} from '@/components/publication-send';
export const maxDuration=60;
export default async function NewsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await readDatabase(() => db.newsItem.findUnique({ where: { id }, include: newsInclude }));
  if (!result.available) return <DatabaseNotice />;
  const item = result.data;
  if (!item) notFound();
  let manualSendEnabled=false;
  try{assertManualSendEnabled(process.env);readPublisherEnv();manualSendEnabled=true;}catch{/* Fail closed when deployment is not configured. */}
  const review=(item.validationResult as {review?:{code:string;detail?:string;explanation?:string}[]}|null)?.review??[];
  return <><PageTitle title={item.title} description={`سجل الخبر · ${item.id}`} /><div className="section-title"><Badge value={item.status} /><span className="muted">{date(item.createdAt)}</span></div>
    <section className="panel"><h2>الصياغة العربية</h2><p className="original">{item.arabicContent ?? "لم تُنتج صياغة بعد"}</p><dl className="facts"><dt>التحقق</dt><dd><Badge value={item.validationStatus} /></dd><dt>وضع النشر عند المعالجة</dt><dd>{label(item.modeAtProcessing)}</dd><dt>أسباب المراجعة</dt><dd>{item.needsReviewReasons.join(" / ") || "—"}</dd><dt>سبب الرفض</dt><dd>{item.rejectionReason ?? "—"}</dd><dt>الاعتماد</dt><dd>{date(item.approvedAt)} {item.approvedBy}</dd><dt>بداية / نهاية المعالجة</dt><dd>{date(item.processingStartedAt)} / {date(item.processingEndedAt)}</dd><dt>خطأ المعالجة</dt><dd>{item.error ?? "—"}</dd><dt>نسخة القواعد</dt><dd>{item.ruleSet?.version ?? "لم تُحدد"}</dd></dl><details><summary>التحقق والأدلة والاقتباسات المحمية</summary><JsonView value={{ validation: item.validationResult, facts: item.factualEvidence, protectedQuotes: item.protectedQuotes }} /></details></section>
    {!item.publication&&!item.error&&['PASSED','NEEDS_REVIEW'].includes(item.validationStatus)&&['NEEDS_REVIEW','PENDING_APPROVAL'].includes(item.status)&&<PublicationApproval id={item.id} digest={approvalDigest(item)} reviews={[...new Map(review.map(r=>[reviewKey(r),{key:reviewKey(r),label:`${r.explanation??r.code}${r.detail?` — ${r.detail}`:''}`}])).values()]}/>}
    <section className="panel"><h2>الحدث الأساسي</h2><p>{item.eventRevision.event.title}</p><p>{item.eventRevision.event.summary}</p><dl className="facts"><dt>معرّف الحدث</dt><dd><bdi>{item.eventRevision.eventId}</bdi></dd><dt>الإصدار</dt><dd>{item.eventRevision.revision}</dd><dt>التطور الجوهري</dt><dd>{item.eventRevision.materialChange ?? "—"}</dd></dl><details><summary>حقائق الحدث</summary><JsonView value={item.eventRevision.facts} /></details>
    {item.eventRevision.matches.map(match => <article className="news-row" key={match.id}><Badge value={match.classification} /><p>{match.sourcePost.source.name} · {match.rationale}</p><Link className="text-link" href={`/posts/${match.sourcePostId}`}>منشور المصدر وسجل المعالجة ←</Link><p className="muted small">الثقة: {match.confidence ?? "—"} · نسخة المطابقة: {match.matcherVersion ?? "—"}</p></article>)}</section>
    <section className="panel"><h2>المصادر الأصلية</h2>{!item.evidence.length && <p className="muted">لا توجد أدلة مرتبطة بعد.</p>}{item.evidence.map(({ sourcePost: post }) => <article className="news-row" key={post.id}><h3>{post.source.name} · {post.source.platform}</h3><p className="muted">اللغة: {post.originalLanguage ?? "غير محددة"} · {date(post.sourcePublishedAt)}</p><p className="original" dir="auto">{post.originalContent}</p><SourceLink url={post.sourceUrl} /><p><Link href={`/posts/${post.id}`} className="text-link">سجل المعالجة ←</Link></p></article>)}</section>
    {item.publication?.status==='PENDING'&&item.publication.attemptCount===0&&item.status==='APPROVED'&&<PublicationSend id={item.publication.id} digest={item.publication.idempotencyKey} destination={item.publication.destination} content={item.publication.contentSnapshot} enabled={manualSendEnabled}/>}
    {item.publication&&['SENDING','UNKNOWN','FAILED'].includes(item.publication.status)&&<p role="status">توقف هذا المنشور عن المحاولة. تحقق يدوياً من Telegram وسجل الإرسال قبل أي إجراء؛ إعادة تحميل الصفحة لا تعيد الإرسال.</p>}
    <section className="panel"><h2>نتيجة النشر</h2>{item.publication ? <><Badge value={item.publication.status} /><dl className="facts"><dt>معرّف رسالة Telegram</dt><dd>{item.publication.telegramMessageId ?? "—"}</dd><dt>وقت الإرسال</dt><dd>{date(item.publication.sentAt)}</dd><dt>المحاولات</dt><dd>{item.publication.attemptCount}</dd><dt>المحاولة التالية</dt><dd>{date(item.publication.nextRetryAt)}</dd><dt>الخطأ</dt><dd>{item.publication.error ?? "—"}</dd></dl><details><summary>تفاصيل الإرسال والمحاولات</summary><JsonView value={{ result: item.publication.telegramResult, attempts: item.publication.attempts }} /></details></> : <p className="muted">لا يوجد سجل إرسال لهذا الخبر.</p>}</section></>;
}
