import {Prisma,type PrismaClient} from '@prisma/client';
export type PageParams=Record<string,string|string[]|undefined>;
export type PageProps={searchParams:Promise<PageParams>};
export const pageSize=50;
export function pageNumber(value:PageParams[string]){const n=typeof value==='string'&&/^[1-9]\d{0,6}$/.test(value)?Number(value):1;return n;}
export function pageWindow(requested:number,total:number){const pages=Math.max(1,Math.ceil(total/pageSize));const page=Math.min(Math.max(1,requested),pages);return {page,pages,total,skip:(page-1)*pageSize,take:pageSize};}
export function pageHref(path:string,params:PageParams,key:string,page:number){const query=new URLSearchParams();for(const [k,v]of Object.entries(params))if(typeof v==='string')query.set(k,v);query.set(key,String(page));return `${path}?${query}`;}
// Mirrors readEditorialState, including historical fallback. Eligibility is SQL
// BEFORE both count and LIMIT; delivery HOLD and publishing switches are absent.
const ready=Prisma.sql`CASE WHEN n."validationResult"->>'editorialEligibility' IN ('READY_TO_PUBLISH','NEEDS_REVIEW','FILTERED','PROCESSING_ERROR') THEN n."validationResult"->>'editorialEligibility'='READY_TO_PUBLISH' ELSE n.error IS NULL AND n.status='PENDING_APPROVAL' AND n."validationResult"->'validated'='true'::jsonb END`;
export async function newsPage(db:PrismaClient,mode:'readonly'|'review'|'approval',requested:number){
 const eligible=mode==='approval'?Prisma.sql`NOT EXISTS (SELECT 1 FROM "HumanEditorialDraft" d WHERE d."newsItemId"=n.id) AND n.status IN ('PENDING_APPROVAL','APPROVED','NEEDS_REVIEW') AND n.error IS NULL AND n."validationStatus" IN ('PASSED','NEEDS_REVIEW') AND (COALESCE(${ready},false) OR n.status='APPROVED')`:mode==='review'?Prisma.sql`n.status='NEEDS_REVIEW' AND NOT EXISTS (SELECT 1 FROM "HumanEditorialDraft" d WHERE d."newsItemId"=n.id) AND NOT COALESCE(${ready},false)`:Prisma.sql`true`;
 return db.$transaction(async tx=>{
  const [count]=await tx.$queryRaw<{total:number}[]>(Prisma.sql`SELECT count(*)::int AS total FROM "NewsItem" n WHERE ${eligible}`);
  const paging=pageWindow(requested,count.total);
  const ids=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT n.id FROM "NewsItem" n WHERE ${eligible} ORDER BY n."createdAt" DESC,n.id DESC LIMIT ${paging.take} OFFSET ${paging.skip}`);
  const items=await tx.newsItem.findMany({where:{id:{in:ids.map(x=>x.id)}},orderBy:[{createdAt:'desc'},{id:'desc'}],include:{publication:true,evidence:{include:{sourcePost:{include:{source:true}}}}}});
  return {items,...paging};
 },{isolationLevel:'RepeatableRead'});
}
export const unresolvedWhere:Prisma.SourcePostWhereInput={status:{in:['NEEDS_REVIEW','FAILED']},evidence:{none:{}},humanDraft:{is:null},jobs:{none:{status:{in:['PENDING','RETRY','RUNNING']}}},OR:[{processingResult:{equals:Prisma.DbNull}},{processingResult:{equals:Prisma.JsonNull}},{AND:[{NOT:{processingResult:{path:['editorialEligibility'],equals:'PROCESSING_ERROR'}}},{NOT:{processingResult:{path:['editorialEligibility'],equals:'MATCHING_HOLD'}}}]}]};
export async function unresolvedPage(db:PrismaClient,requested:number){return db.$transaction(async tx=>{const paging=pageWindow(requested,await tx.sourcePost.count({where:unresolvedWhere}));const items=await tx.sourcePost.findMany({where:unresolvedWhere,skip:paging.skip,take:paging.take,orderBy:[{ingestedAt:'desc'},{id:'desc'}],include:{source:true}});return {items,...paging};},{isolationLevel:'RepeatableRead'});}
