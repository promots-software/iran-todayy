import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {PrismaClient,Prisma} from '@prisma/client';
import {readBudgetSummary} from '../src/worker/provider-budget-summary';
import {geminiResource} from '../src/worker/provider-guard';
import {canonicalEventSnapshot} from '../src/lib/processing/canonical-event-snapshot';
const bytes=(x:unknown)=>Buffer.byteLength(JSON.stringify(x));
test('offline returned-byte benchmark: accounting history versus one summary',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 assert.equal(new URL(process.env.TEST_DATABASE_URL!).hostname,'127.0.0.1');
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const now=Date.UTC(2026,8,28,0),rows:Prisma.AuditLogCreateManyInput[]=[];
 for(let i=0;i<1500;i++){
  const at=new Date(now-i*50000),base={createdAt:at,entityType:'ProviderBudget',entityId:'gemini',message:'offline'};
  rows.push({...base,id:'bench-r'+i,action:'PROVIDER_RESERVED',metadata:{usd:.014,bytes:32000,inputTokens:32000,outputTokens:4096,resource:geminiResource,postId:'offline-post-'+i,key:'offline-checkpoint-'+i,operationAttempt:1}});
  rows.push({...base,id:'bench-s'+i,action:'PROVIDER_USAGE_SETTLED',metadata:{reservationId:'bench-r'+i,usd:.001,inputTokens:4000}});
  rows.push({...base,id:'bench-h'+i,action:'PROVIDER_CAPACITY_HEALTHY',metadata:{resource:geminiResource,requestStartedAt:at.getTime()}});
 }
 for(let i=0;i<2345;i++)rows.push({id:'bench-j'+i,action:'PROVIDER_JOB_ADMITTED',createdAt:new Date(now-i*30000),entityType:'ProviderBudget',entityId:'gemini',message:'offline'});
 try{
  await db.auditLog.createMany({data:rows});
  const before=await db.auditLog.findMany({where:{entityType:'ProviderBudget',entityId:'gemini'},select:{id:true,action:true,metadata:true,createdAt:true}});
  let aggregateBytes=0;
  const aggregateDb={$queryRaw:async(q:Prisma.Sql)=>{const r=await db.$queryRaw<unknown[]>(q);aggregateBytes=bytes(r);return r;}} as Pick<PrismaClient,'$queryRaw'>;
  await readBudgetSummary(aggregateDb,now,geminiResource,.006,1000,3);assert(aggregateBytes<2000);
  const catalog=JSON.parse(readFileSync('tests/fixtures/canonical-retrieval-v1/historical.json','utf8')).catalog;
  for(const c of catalog){
   await db.canonicalEvent.upsert({where:{id:c.id},update:{},create:{id:c.id,title:'offline',summary:'offline',facts:{},createdAt:new Date(c.createdAt)}});
   await db.eventRevision.upsert({where:{id:c.revisionId},update:{},create:{id:c.revisionId,eventId:c.id,revision:c.revision,facts:c.data}});
  }
  const oldSnapshot=await db.canonicalEvent.findMany({select:{id:true,createdAt:true,revisions:{orderBy:{revision:'desc'},take:1,select:{id:true,revision:true,facts:true,newsItem:{select:{publication:{select:{status:true}}}},matches:{orderBy:[{createdAt:'asc'},{id:'asc'}],take:1,select:{sourcePost:{select:{sourcePublishedAt:true}}}}}}}});
  const returned:{rows:number;bytes:number}[]=[];
  const wrapped={$queryRaw:async(q:Prisma.Sql)=>{const r=await db.$queryRaw<unknown[]>(q);returned.push({rows:r.length,bytes:bytes(r)});return r;}} as Pick<Prisma.TransactionClient,'$queryRaw'>;
  const cold=await canonicalEventSnapshot(wrapped),warm=await canonicalEventSnapshot(wrapped);
  assert.equal(cold.key,warm.key);assert(returned[1].bytes<returned[0].bytes);
  for(let i=0;i<100;i++){
   const event=await db.canonicalEvent.create({data:{title:'offline',summary:'offline',facts:{},revisions:{create:{facts:{},newsItem:{create:{title:'offline'}}}}},include:{revisions:{include:{newsItem:true}}}});
   await db.publication.create({data:{newsItemId:event.revisions[0].newsItem!.id,idempotencyKey:'bench'+i,contentSnapshot:'offline',destination:'OFFLINE',status:'SENT',automaticPolicyId:'bench'}});
  }
  const history=await db.publication.findMany({where:{automaticPolicyId:'bench'},select:{id:true,status:true,newsItemId:true},orderBy:{createdAt:'asc'}});
  const blocked=await db.publication.findFirst({where:{automaticPolicyId:'bench',status:{in:['SENDING','UNKNOWN','FAILED']}},select:{id:true}});
  const pending=await db.publication.findMany({where:{automaticPolicyId:'bench',status:'PENDING'},select:{id:true,status:true,newsItemId:true},orderBy:{createdAt:'asc'}});
  const output={fixture:'6845 synthetic accounting rows with runtime metadata shape; frozen historical candidate catalog; 100 synthetic sent publications',units:'UTF-8 JSON result bytes, not PostgreSQL/TLS wire bytes',provider:{before:{queries:1,rows:before.length,bytes:bytes(before)},after:{queries:1,rows:1,bytes:aggregateBytes}},snapshot:{before:{rows:oldSnapshot.length,bytes:bytes(oldSnapshot)},cold:returned[0],warm:returned[1]},publisher:{before:{queries:1,rows:history.length,bytes:bytes(history)},after:{queries:2,rows:0,bytes:bytes(blocked)+bytes(pending)}},projection:[480,500,600].map(incoming=>{
   const requests=incoming*(628/746)*(205/61),calls=2880+requests;
   return {incoming,monitorAndRequestQueries:calls,beforeBytes:calls*bytes(before),afterBytes:calls*aggregateBytes,monitorOnlyAfterBytes:2880*aggregateBytes};
  }),totalApplicationEgress:'UNVERIFIED: other queries and future retry/candidate mix not measured'};
  mkdirSync('.test-tools/egress',{recursive:true});writeFileSync('.test-tools/egress/benchmark.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));
 }finally{await db.$disconnect();}
});
