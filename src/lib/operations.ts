import type {PrismaClient} from '@prisma/client';
import {queueHealth,latencySummary} from './queue-health';
import {workerIsStale} from './domain';
export const productionWorkerIds=new Set(['telegram-production-worker','telegram-publisher-worker']);
export const workerIsProduction=(id:string)=>productionWorkerIds.has(id);
export const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export const safeCode=(v:unknown)=>typeof v==='string'&&/^[A-Z][A-Z0-9_:.-]{0,120}$/.test(v)?v:'غير مصنف';
export function failureCategory(code:string){return /COST/.test(code)?'cost':/PROVIDER|GEMINI|GROQ|OPENAI/.test(code)?'provider':/SOURCE|LANGUAGE/.test(code)?'source':/EVIDENCE|ATTRIBUTION|UNSUPPORTED|COMPLETENESS|MATERIAL|RENDERING/.test(code)?'validation':/DATABASE|PRISMA/.test(code)?'database':'technical';}
export function safeAuditChange(value:unknown){
 const m=record(value),allow=['username','displayName','role','enabled','processingMode','previousMode','publishingMode','previous','before','after'];
 const pick=(v:unknown):unknown=>{if(typeof v==='boolean'||typeof v==='number'||v===null)return v;if(typeof v==='string')return v.length<=100?v:'قيمة طويلة';const r=record(v);return Object.fromEntries(['username','displayName','role','enabled','processingMode','publishingMode','status','lastError','attemptCount'].filter(k=>k in r).map(k=>[k,typeof r[k]==='string'?String(r[k]).slice(0,100):typeof r[k]==='boolean'||typeof r[k]==='number'?r[k]:null]));};
 return allow.filter(k=>k in m).map(k=>`${k}: ${JSON.stringify(pick(m[k]))}`).join(' · ');
}
export function beirutDayStart(now:Date){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Beirut',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const value=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
 const utc=Date.UTC(value('year'),value('month')-1,value('day'));
 const offset=new Intl.DateTimeFormat('en',{timeZone:'Asia/Beirut',timeZoneName:'longOffset'}).formatToParts(new Date(utc)).find(p=>p.type==='timeZoneName')!.value;
 const m=/GMT([+-])(\d{2}):(\d{2})/.exec(offset);return new Date(utc-(m?(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3]))*60000:0));
}
export function usageSummary(rows:{metadata:unknown}[]){
 const values=rows.map(r=>record(r.metadata)),network=values.filter(v=>v.replayed!==true);
 const sum=(key:string)=>network.reduce((s,v)=>s+(typeof v[key]==='number'?v[key] as number:0),0);
 return {attempts:network.length,replays:values.length-network.length,success:network.filter(v=>v.httpStatus===200).length,rateLimited:network.filter(v=>v.httpStatus===429).length,serverErrors:network.filter(v=>typeof v.httpStatus==='number'&&v.httpStatus>=500).length,otherFailures:network.filter(v=>v.httpStatus!==200&&v.httpStatus!==429&&!(typeof v.httpStatus==='number'&&v.httpStatus>=500)).length,input:sum('inputTokens'),output:sum('outputTokens'),thinking:sum('thinkingTokens'),estimatedUsd:sum('estimatedCostUsd'),missingUsage:network.filter(v=>typeof v.inputTokens!=='number'||typeof v.outputTokens!=='number').length,latency:latencySummary(network.flatMap(v=>typeof v.durationMs==='number'?[v.durationMs]:[])),stages:Object.fromEntries([...new Set(network.map(v=>String(v.stage)))].map(stage=>[stage,network.filter(v=>v.stage===stage).length]))};
}
export async function operationsSnapshot(db:PrismaClient,now=new Date()){
 const today=beirutDayStart(now),since=new Date(now.getTime()-86400000),start=performance.now();await db.$queryRaw`SELECT 1`;const databaseMs=Math.round(performance.now()-start);
 const [workers,queue,settings,sources,posts,jobs,publications,activity,usage,failures,migrations,lastSent,totalPosts,totalNews,legacyPending]=await Promise.all([
  db.workerHeartbeat.findMany({orderBy:{lastSeenAt:'desc'}}),queueHealth(db),db.appSettings.findUnique({where:{id:1}}),
  db.source.findMany({where:{deletedAt:null},select:{id:true,name:true,handle:true,platform:true,enabled:true,processingMode:true,processingPaused:true,cursor:true,lastPollAt:true,lastError:true,posts:{orderBy:{ingestedAt:'desc'},take:1,select:{sourcePostId:true,ingestedAt:true}}}}),
  db.sourcePost.findMany({where:{ingestedAt:{gte:today,lte:now}},select:{id:true,sourceId:true,status:true,relevanceResult:true,processingResult:true}}),
  db.processingJob.groupBy({by:['status','lastError'],_count:true}),db.publication.groupBy({by:['status','destination'],_count:true}),
  db.auditLog.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}],take:60,select:{id:true,action:true,actor:true,entityType:true,entityId:true,createdAt:true,metadata:true}}),
  db.auditLog.findMany({where:{action:'AI_STAGE_USAGE',createdAt:{gte:since,lte:now}},select:{metadata:true}}),
  db.processingJob.findMany({where:{status:{in:['FAILED','RETRY']}},orderBy:{updatedAt:'desc'},take:100,select:{id:true,sourcePostId:true,status:true,stage:true,lastError:true,attemptCount:true,availableAt:true,updatedAt:true}}),
  db.$queryRaw<{migration_name:string;finished_at:Date|null;rolled_back_at:Date|null}[]>`SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 20`,
  db.publication.findFirst({where:{status:'SENT'},orderBy:{sentAt:'desc'},select:{id:true,sentAt:true,destination:true,telegramMessageId:true}}),db.sourcePost.count(),db.newsItem.count(),db.publication.count({where:{status:'PENDING',automaticPolicyId:null}}),
 ]);
 const counts:Record<string,number>={},modes:Record<string,number>={NORMAL:0,DIRECT:0,UNRECORDED:0};
 for(const p of posts){counts[p.status]=(counts[p.status]??0)+1;const mode=record(p.processingResult).processingMode??record(p.relevanceResult).processingMode;modes[mode==='DIRECT'||mode==='NORMAL'?mode:'UNRECORDED']++;}
 const alerts:{severity:string;component:string;since:Date|null;message:string}[]=[];
 for(const w of workers)if(workerIsProduction(w.id)&&workerIsStale(w.lastSeenAt,w.intervalMs))alerts.push({severity:'WARNING',component:w.id,since:w.lastSeenAt,message:'النبضة متأخرة؛ تحقق من العامل قبل أي تدخل.'});
 for(const s of sources)if(s.enabled&&s.lastError)alerts.push({severity:'WARNING',component:s.handle,since:null,message:`آخر خطأ للمصدر: ${safeCode(s.lastError)}. وقت بدايته غير مسجل.`});
 if(queue.capacity.reason)alerts.push({severity:'WARNING',component:'Gemini',since:null,message:`حاجز الطلبات الحالي: ${safeCode(queue.capacity.reason)}؛ لا يوقف جمع المصادر.`});
 if(queue.capacity.cost.warning)alerts.push({severity:'WARNING',component:'Cost',since:null,message:'بلغت الكلفة المحسوبة حد التحذير؛ يشمل المجموع الحجوزات المعلقة.'});
 const uncertain=publications.filter(p=>['SENDING','UNKNOWN'].includes(p.status)).reduce((s,p)=>s+p._count,0);
 if(uncertain)alerts.push({severity:'CRITICAL',component:'Publishing',since:null,message:`${uncertain} عمليات إرسال تحتاج إلى تسوية؛ لا تُعد الإرسال.`});
 return {at:now,today,since,databaseMs,workers:workers.map(w=>({...w,production:workerIsProduction(w.id)})),queue,settings,sources:sources.map(s=>({...s,lastError:s.lastError?safeCode(s.lastError):null,postsToday:posts.filter(p=>p.sourceId===s.id).length})),counts,modes,totalToday:posts.length,materialUpdates:posts.filter(p=>record(p.processingResult).classification==='MATERIAL_UPDATE').length,jobs,publications,activity:activity.map(({metadata,...a})=>({...a,change:safeAuditChange(metadata)})),usage:usageSummary(usage),failures:failures.map(f=>({...f,lastError:safeCode(f.lastError)})),migrations,lastSent,totalPosts,totalNews,legacyPending,alerts};
}
