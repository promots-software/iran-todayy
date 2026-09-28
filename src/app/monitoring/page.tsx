import Link from 'next/link';
import {requirePageAccess} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {monitoringFeed, monitoringHref, monitoredSource, monitoredText} from '@/lib/monitoring-feed';
import type {PageProps} from '@/lib/dashboard-pagination';
import {PageTitle, DatabaseNotice, EmptyState} from '@/components/ui';
import {MonitoringRefresh} from '@/components/monitoring-refresh';
import {date} from '@/lib/labels';
import {safeSourceUrl} from '@/lib/domain';

export default async function MonitoringPage({searchParams}: PageProps) {
  await requirePageAccess('/monitoring');
  const params = await searchParams;
  const source = typeof params.source === 'string' ? params.source : undefined;
  const before = typeof params.before === 'string' ? params.before : undefined;
  const result = await readDatabase(() => monitoringFeed(db, {source, before}));
  return <>
    <PageTitle eyebrow="غرفة الرصد" title="رصد" description="ماذا رصد النظام من المصادر؟" actions={<MonitoringRefresh live={!before}/>}/>
    {!result.available ? <DatabaseNotice/> : <>
      <form className="filters dashboard-filter"><label>المصدر<select name="source" defaultValue={source ?? ''}><option value="">الكل</option>{result.data.sources.map(s => <option key={s.id} value={s.id}>{monitoredSource(s)}</option>)}</select></label><button>تصفية</button></form>
      {!result.data.items.length && <EmptyState/>}
      {result.data.items.map(post => {
        const url = safeSourceUrl(post.sourceUrl);
        return <article className="panel monitoring-card" key={post.id} data-source-post-id={post.id}>
          <header className="monitoring-meta"><div className="monitoring-source"><h2>{post.source.name || post.source.id}</h2>{post.source.handle && <bdi className="muted small">{post.source.handle.startsWith('@') ? post.source.handle : '@'+post.source.handle}</bdi>}<span className="badge neutral">{post.source.platform === 'TELEGRAM' ? 'Telegram' : 'X'}</span></div><time dateTime={post.ingestedAt.toISOString()}>وقت الرصد: {date(post.ingestedAt)}</time></header>
          <div dir="auto" className="monitoring-text">{monitoredText(post.originalContent)}</div>
          <div className="monitoring-links">{url && <a className="original-post-action" href={url} target="_blank" rel="noopener noreferrer">المنشور الأصلي ↗</a>}<span className="small">رقم منشور {post.source.platform === 'TELEGRAM' ? 'Telegram' : 'X'}: <bdi>{post.sourcePostId}</bdi></span></div>
        </article>;
      })}
      <nav className="section-title" aria-label="صفحات الرصد">{before && <Link href={monitoringHref(source)}>أحدث المنشورات</Link>}{result.data.next && <Link href={monitoringHref(source, result.data.next)}>منشورات أقدم ←</Link>}</nav>
    </>}
  </>;
}
