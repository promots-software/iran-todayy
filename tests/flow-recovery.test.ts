import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient,type ProcessingJob} from '@prisma/client';
import {costWaitRecheckBefore,type providerCapacitySnapshot,limits} from '../src/worker/provider-guard';
import {sourceLanguage} from '../src/lib/processing/source-language';
import {ingest,claimJob} from '../src/lib/processing/engine';
const snapshot=(now:number)=>({observedAt:now,state:'AVAILABLE',quotas:{reason:null},costRolling24hUsd:1.1} as Awaited<ReturnType<typeof providerCapacitySnapshot>>);
test('cost wait reconsideration needs fresh healthy capacity and conservative headroom',()=>{
 const now=Date.now(),s=snapshot(now);
 assert.equal(costWaitRecheckBefore(s,now)?.getTime(),now);
 assert.equal(limits.dayReservedUsd,2);
 for(const x of [null,{...s,state:'CAPACITY_WAIT'},{...s,quotas:{...s.quotas,reason:'PROVIDER_RPD_WAIT'}},{...s,observedAt:now-60001},{...s,observedAt:now+1},{...s,costRolling24hUsd:2.99}])assert.equal(costWaitRecheckBefore(x,now),undefined);
});
test('one normal claim rechecks stale cost schedules without bulk requeue or same-snapshot churn',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');const db=new PrismaClient({datasourceUrl:url});
 try{
 const src=await db.source.create({data:{name:'offline',platform:'TELEGRAM',handle:'offlinecostrecheck',url:'https://t.me/offlinecostrecheck'}});
 const future=new Date(Date.now()+3600000),old=new Date(Date.now()-300000);
 const jobs:ProcessingJob[]=[];
 for(let i=0;i<3;i++){const p=await ingest(db,src.id,{externalId:String(i),url:src.url+'/'+i,content:'أعلنت الوزارة افتتاح مشروع جديد في المدينة',publishedAt:old});const j=await db.processingJob.findFirstOrThrow({where:{sourcePostId:p.id}});await db.sourcePost.update({where:{id:p.id},data:{status:'FAILED'}});jobs.push(await db.processingJob.update({where:{id:j.id},data:{status:'RETRY',lastError:i===2?'GEMINI_HTTP_503':'PROVIDER_COST_WAIT',availableAt:future,updatedAt:old}}));}
 const observed=new Date();
 assert.equal(await claimJob(db,'offline',new Date(),true,[],true),null);
 const claims=await Promise.all([claimJob(db,'lane1',new Date(),true,[],true,observed),claimJob(db,'lane2',new Date(),true,[],true,observed)]);
 assert.equal(new Set(claims.map(j=>j?.id)).size,2);assert(claims.every(j=>j&&jobs.slice(0,2).some(x=>x.id===j.id)));
 for(const j of claims){assert.equal(j!.availableAt.getTime(),future.getTime());await db.processingJob.update({where:{id:j!.id},data:{status:'RETRY',lockedAt:null,lockedBy:null,availableAt:future,updatedAt:new Date(observed.getTime()+1)}});}
 assert.equal(await claimJob(db,'offline',new Date(),true,[],true,observed),null);
 assert.equal((await db.processingJob.findUniqueOrThrow({where:{id:jobs[2].id}})).lastError,'GEMINI_HTTP_503');
 assert.equal(await db.auditLog.count({where:{action:'PROCESSING_COST_WAIT_RECHECKED'}}),2);
 assert.equal(await db.publication.count(),0);
 }finally{await db.$disconnect();}
});
test('Arabic footer identifiers and nominal clauses do not imply mixed language',()=>{
 const texts=[
 'مصادر محلية: قوات الاحتلال تعتقل سيدة خلال اقتحام بلدة فحمة جنوب غرب جنين\n\ndesk_channel',
 'مصادر محلية في صعدة اليمنية: العدو السعودي يعاود استهداف مناطق مأهولة بالسكان في مديريتي الظاهر وحيدان بعشرات الصواريخ والقذائف المدفعية\n\ndesk_channel',
 'إطلاق نار من دبابات الاحتلال تجاه شرق مخيم جباليا شمال قطاع غزة\n\ndesk_channel',
 'الطيران الحربي السعودي يشن غارتين على مجمع المتون في الجوف اليمنية\n\ndesk_channel',
 'الطيران المدني الإيراني ينفي وقف الرحلات الجوية بين إيران والعراق\n\ndesk_channel',
 'المرجع الديني الإيراني آيةالله السيدموسى شبيري زنجاني في ذمة الله\n\ndesk_channel',
 'قصف مدفعي إسرائيلي استهدف وادي زبقين في جنوب لبنان',
 'قاليباف: أمريكا تحاول خنق إيران من دون أي تداعيات أو ثمن وهو أمر مستحيل',
 'مشروع بلدي جديد في حي سكني',
 ];
 for(const text of texts){const original=text;assert.equal(sourceLanguage(text),'ar');assert.equal(text,original);}
 for(const text of ['أعلنت الوزارة المشروع الجديد\n\nthe','أعلنت الوزارة المشروع الجديد\n\nthe project is new','قصف مدفعي إسرائيلي','الكتاب دانشگاه\n\ndesk_channel','أعلنت الوزارة أن المشروع الجديد سيبدأ\nاین طرح برای مردم کشور است'])assert.equal(sourceLanguage(text),'unknown');
 assert.equal(sourceLanguage('این طرح برای مردم کشور مهم است و فردا اجرا خواهد شد\n\ndesk_channel'),'fa');
});
