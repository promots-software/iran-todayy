import type {PrismaClient,Prisma} from '@prisma/client';
import {beirutDayStart} from './operations';

/** News counters use today's Beirut calendar day; configured sources include disabled sources.
 * Count human-rejected NewsItems too; exclude their linked posts from the other count.
 * OR counts each remaining source post once when rejection and unrelated reasons overlap.
 */
export function overviewPredicates(now=new Date()) {
 const period={gte:beirutDayStart(now),lte:now};
 return {
  sources:{deletedAt:null} satisfies Prisma.SourceWhereInput,
  published:{status:'SENT',sentAt:period} satisfies Prisma.PublicationWhereInput,
  duplicates:{status:'DUPLICATE',ingestedAt:period} satisfies Prisma.SourcePostWhereInput,
  rejectedNews:{status:'REJECTED',createdAt:period} satisfies Prisma.NewsItemWhereInput,
  unrelatedRejected:{ingestedAt:period,evidence:{none:{newsItem:{status:'REJECTED',createdAt:period}}},OR:[{status:'REJECTED'},{status:'FILTERED',rejectionReason:{in:['UNRELATED_TO_IRAN','UNRELATED']}}]} satisfies Prisma.SourcePostWhereInput,
 };
}
export async function overviewData(db:PrismaClient,now=new Date()) {
 const where=overviewPredicates(now);
 const [sources,published,duplicates,unrelatedPosts,rejectedNews]=await Promise.all([
  db.source.count({where:where.sources}),
  db.publication.count({where:where.published}),
  db.sourcePost.count({where:where.duplicates}),
  db.sourcePost.count({where:where.unrelatedRejected}),
  db.newsItem.count({where:where.rejectedNews}),
 ]);
 return {sources,published,duplicates,unrelatedRejected:unrelatedPosts+rejectedNews};
}
