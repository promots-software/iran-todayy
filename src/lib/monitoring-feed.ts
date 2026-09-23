import type {Prisma, PrismaClient} from '@prisma/client';

export const monitoringPageSize = 50;
type Params = {source?: string; before?: string};
const select = {
  id: true, sourcePostId: true, sourceUrl: true, originalContent: true, ingestedAt: true,
  source: {select: {id: true, name: true, handle: true, platform: true}},
} satisfies Prisma.SourcePostSelect;

export function monitoringCursor(post: {id: string; ingestedAt: Date}) {
  return Buffer.from(JSON.stringify([post.ingestedAt.toISOString(), post.id])).toString('base64url');
}
function decodeCursor(value?: string): {time: Date; id: string} | null {
  if (!value || value.length > 512) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(data) || data.length !== 2 || typeof data[0] !== 'string' || typeof data[1] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data[1])) return null;
    const time = new Date(data[0]);
    return Number.isFinite(time.getTime()) ? {time, id: data[1]} : null;
  } catch { return null; }
}
export function monitoringQuery(params: Params): Prisma.SourcePostFindManyArgs {
  const cursor = decodeCursor(params.before);
  return {
    where: {
      source: {platform: 'TELEGRAM'},
      ...(params.source ? {sourceId: params.source} : {}),
      ...(cursor ? {OR: [{ingestedAt: {lt: cursor.time}}, {ingestedAt: cursor.time, id: {lt: cursor.id}}]} : {}),
    },
    select, orderBy: [{ingestedAt: 'desc'}, {id: 'desc'}], take: monitoringPageSize + 1,
  };
}
/** Durable ingestion only. Never consult jobs, outcomes, evidence, or publication state. */
export async function monitoringFeed(db: PrismaClient, params: Params) {
  const [rows, sources] = await Promise.all([
    db.sourcePost.findMany({...monitoringQuery(params), select}),
    db.source.findMany({where: {platform: 'TELEGRAM'}, select: {id: true, name: true, handle: true}, orderBy: [{name: 'asc'}, {id: 'asc'}]}),
  ]);
  const items = rows.slice(0, monitoringPageSize);
  return {items, sources, next: rows.length > monitoringPageSize ? monitoringCursor(items[items.length - 1]) : null};
}
export function monitoringHref(source?: string, before?: string | null) {
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  if (before) params.set('before', before);
  return '/monitoring' + (params.size ? '?' + params.toString() : '');
}
export function monitoredText(original: string) {return original.trim() ? original : 'منشور بلا نص';}
export function monitoredSource(source: {id: string; name: string; handle: string}) {
  const handle = source.handle ? (source.handle.startsWith('@') ? source.handle : '@' + source.handle) : '';
  return [source.name || source.id, handle].filter(Boolean).join(' — ');
}
