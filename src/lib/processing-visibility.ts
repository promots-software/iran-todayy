import {Prisma,type PrismaClient,ProcessingStatus} from '@prisma/client';
import {pageWindow,type PageParams} from './dashboard-pagination';
export const activeHistoryWhere:Prisma.SourcePostWhereInput={OR:[{rejectionReason:null},{rejectionReason:{not:'HISTORICAL_INGESTION_RETIRED'}}]};
export const duplicateWhere:Prisma.EventMatchWhereInput={classification:'DUPLICATE',sourcePost:activeHistoryWhere};
export async function duplicatePage(db:PrismaClient,requested:number){return db.$transaction(async tx=>{
 const paging=pageWindow(requested,await tx.eventMatch.count({where:duplicateWhere}));
 const items=await tx.eventMatch.findMany({
  where:duplicateWhere,skip:paging.skip,take:paging.take,orderBy:[{createdAt:'desc'},{id:'desc'}],
  select:{id:true,sourcePostId:true,createdAt:true,rationale:true,sourcePost:{select:{originalContent:true,sourceUrl:true,source:{select:{id:true,name:true,handle:true,platform:true}}}},eventRevision:{select:{eventId:true,event:{select:{title:true}},newsItem:{select:{id:true}}}}}
 });
 return {items,...paging};
},{isolationLevel:'RepeatableRead'});}
export const outcomeFilters=['all','processing','technical','duplicate','review','ready','rejected','published','historical'] as const;
export function outcomeWhere(params:PageParams):Prisma.SourcePostWhereInput{
 const state=typeof params.state==='string'?params.state:'all';
 const statuses:Record<string,ProcessingStatus[]>={processing:['INGESTED','NORMALIZED','CLASSIFYING','DEDUPLICATING','DRAFTING','VALIDATING','QUEUED'],technical:['FAILED'],duplicate:['DUPLICATE'],review:['NEEDS_REVIEW'],ready:['PENDING_APPROVAL','APPROVED'],rejected:['FILTERED','REJECTED']};
 const where:Prisma.SourcePostWhereInput={AND:[state==='historical'?{rejectionReason:'HISTORICAL_INGESTION_RETIRED'}:activeHistoryWhere]};
 if(statuses[state])where.status={in:statuses[state]};
 if(state==='technical'){delete where.status;where.OR=[{status:'FAILED'},{jobs:{some:{status:{in:['RETRY','FAILED']}}}}];}
 if(state==='published')where.OR=[{status:'PUBLISHED'},{evidence:{some:{newsItem:{publication:{status:'SENT'}}}}},{humanDraft:{publications:{some:{status:'SENT'}}}}];
 if(state==='ready')where.evidence={none:{newsItem:{publication:{status:'SENT'}}}};
 if(typeof params.source==='string'&&params.source.length<=100&&params.source)where.sourceId=params.source;
 if(typeof params.post==='string'&&params.post.length<=100&&params.post)where.id=params.post;
 return where;
}
export async function outcomePage(db:PrismaClient,params:PageParams,requested:number){return db.$transaction(async tx=>{
 const where=outcomeWhere(params),paging=pageWindow(requested,await tx.sourcePost.count({where}));
 const items=await tx.sourcePost.findMany({where,skip:paging.skip,take:paging.take,orderBy:[{ingestedAt:'desc'},{id:'desc'}],select:{id:true,sourcePostId:true,sourceUrl:true,originalContent:true,status:true,error:true,rejectionReason:true,ingestedAt:true,source:{select:{id:true,name:true,handle:true,platform:true}},jobs:{select:{id:true,status:true,lastError:true,attemptCount:true,availableAt:true}},matches:{select:{id:true,classification:true,rationale:true,eventRevision:{select:{eventId:true,newsItem:{select:{id:true}}}}}},evidence:{select:{newsItem:{select:{id:true,status:true,publication:{select:{status:true}}}}}}}});
 const sources=await tx.source.findMany({select:{id:true,name:true,handle:true},orderBy:{name:'asc'}});
 return {items,sources,...paging};
},{isolationLevel:'RepeatableRead'});}
