import type {PrismaClient} from '@prisma/client';

export type OperationsPost = {sourceId:string;status:string;processingMode:unknown;relevanceMode:unknown;classification:unknown};

// Only the scalar JSON members used by Operations cross the database boundary.
// Keep their JSON types: a non-string processingMode must not fall back to relevance.
export function operationsPosts(db:Pick<PrismaClient,'$queryRaw'>,from:Date,to:Date){
 return db.$queryRaw<OperationsPost[]>`SELECT "sourceId",status::text AS status,
 "processingResult"->'processingMode' AS "processingMode",
 "relevanceResult"->'processingMode' AS "relevanceMode",
 "processingResult"->'classification' AS classification
 FROM "SourcePost" WHERE "ingestedAt">=${from.toISOString()}::timestamp AND "ingestedAt"<=${to.toISOString()}::timestamp`;
}
