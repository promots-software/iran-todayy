import {PrismaClient} from '@prisma/client';
import {hashPassword} from '../../src/lib/dashboard-auth';
const url=process.env.TEST_DATABASE_URL!;if(new URL(url).hostname!=='127.0.0.1'||!new URL(url).pathname.startsWith('/qa_'))throw Error('ISOLATED_DATABASE_REQUIRED');
const db=new PrismaClient({datasourceUrl:url});
async function main(){
 await db.appSettings.create({data:{id:1}});
 for(const role of ['SUPER_ADMIN','ADMIN','EDITOR'] as const)await db.dashboardUser.create({data:{username:role.toLowerCase(),displayName:role,role,passwordHash:await hashPassword(process.env.E2E_PASSWORD!)}});
 const source=await db.source.create({data:{id:'qa-source',platform:'TELEGRAM',name:'مصدر الاختبار المعزول',handle:'qa_offline',url:'https://t.me/qa_offline'}});
 for(const name of ['edit','media','send','web','reject','trace'])await db.sourcePost.create({data:{id:'qa-'+name,sourceId:source.id,sourcePostId:name,sourceUrl:source.url+'/'+name,originalContent:'أعلنت البلدية افتتاح حديقة عامة جديدة في بيروت.',sourcePublishedAt:new Date(),status:'NEEDS_REVIEW',error:'UNSUPPORTED_OUTPUT',processingResult:{validated:false,editorialEligibility:'NEEDS_REVIEW',review:[{code:'UNSUPPORTED_OUTPUT'}]},metadata:{hasPhoto:true}}});
 const post=await db.sourcePost.create({data:{id:'qa-sent',sourceId:source.id,sourcePostId:'sent',sourceUrl:source.url+'/sent',originalContent:'خبر منشور سابقاً',sourcePublishedAt:new Date(),status:'PENDING_APPROVAL',processingResult:{validated:true,editorialEligibility:'READY_TO_PUBLISH'}}});
 const event=await db.canonicalEvent.create({data:{title:'خبر منشور',summary:'خبر منشور',facts:{}}});const revision=await db.eventRevision.create({data:{eventId:event.id,facts:{}}});const news=await db.newsItem.create({data:{id:'qa-sent-news',eventRevisionId:revision.id,title:'خبر منشور سابقاً',arabicContent:'',status:'PUBLISHED',validationStatus:'PASSED',validationResult:{validated:true,editorialEligibility:'READY_TO_PUBLISH'},evidence:{create:{sourcePostId:post.id}}}});await db.publication.create({data:{newsItemId:news.id,idempotencyKey:'offline-prior-sent',destination:'-100123',contentSnapshot:news.title,status:'SENT',telegramMessageId:'700',sentAt:new Date(),attemptCount:1}});
 await db.workerHeartbeat.create({data:{id:'legacy-local-worker',state:'STOPPED',phase:'TEST',lastSeenAt:new Date(0)}});
}
main().finally(()=>db.$disconnect());
