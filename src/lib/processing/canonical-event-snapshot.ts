import {Prisma} from '@prisma/client';
import {canonicalDigest} from './canonical-flow';
import {eventSchema,ProcessingError} from './contracts';
import type {RetrievalCandidate} from './canonical-retrieval';
// Content-addressed only: every read recomputes the database fingerprint in the
// same statement that conditionally returns the payload. A cache hit never
// substitutes for the transaction's fresh snapshot/revision check.
const cache=new Map<string,WireEvent>();
type WireEvent={id:string;createdAt:string;revisionId:string|null;revision:number|null;facts:unknown;publishedAt:string;published:boolean};
const utc=(s:string)=>new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s)?s:s+'Z');
export async function canonicalEventSnapshot(db:Pick<Prisma.TransactionClient,'$queryRaw'>){
 const held=new Map(cache);const known=JSON.stringify([...held.keys()]);
 const rows=await db.$queryRaw<{digest:string;payload:WireEvent|null}[]>(Prisma.sql`
 WITH documents AS MATERIALIZED (
 SELECT jsonb_build_object('id',e.id,'createdAt',e."createdAt",'revisionId',r.id,'revision',r.revision,'facts',r.facts,
 'publishedAt',COALESCE(m."sourcePublishedAt",e."createdAt"),'published',COALESCE(p.status::text='SENT',false)) AS payload
 FROM "CanonicalEvent" e
 LEFT JOIN LATERAL (SELECT id,revision,facts FROM "EventRevision" WHERE "eventId"=e.id ORDER BY revision DESC LIMIT 1) r ON true
 LEFT JOIN "NewsItem" n ON n."eventRevisionId"=r.id
 LEFT JOIN "Publication" p ON p."newsItemId"=n.id
 LEFT JOIN LATERAL (SELECT s."sourcePublishedAt" FROM "EventMatch" x JOIN "SourcePost" s ON s.id=x."sourcePostId" WHERE x."eventRevisionId"=r.id ORDER BY x."createdAt",x.id LIMIT 1) m ON true
 ), fingerprints AS (SELECT payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex') digest FROM documents)
 SELECT digest,CASE WHEN digest IN (SELECT jsonb_array_elements_text(${known}::jsonb)) THEN NULL ELSE payload END AS payload FROM fingerprints`);
 const candidates:RetrievalCandidate[]=[];let legacy=0;
 for(const row of rows){const v=row.payload??held.get(row.digest);if(!v)throw new ProcessingError('MATCH_SNAPSHOT_CHANGED',true);if(row.payload)cache.set(row.digest,structuredClone(v));const f=eventSchema.safeParse(v.facts);if(!v.revisionId||!f.success){legacy++;continue;}candidates.push({id:v.id,createdAt:utc(v.createdAt),revisionId:v.revisionId,revision:v.revision!,data:f.data,publishedAt:utc(v.publishedAt),published:v.published});}
 while(cache.size>512)cache.delete(cache.keys().next().value!);
 candidates.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return {candidates,legacy,key:canonicalDigest({candidates,legacy})};
}
