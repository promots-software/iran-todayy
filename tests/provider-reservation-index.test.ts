import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
const migration=readFileSync('prisma/migrations/20260928140000_provider_reservation_attempt_index/migration.sql','utf8');
const index='AuditLog_provider_reservation_attempt_idx';
const postId='fixture-target',key='a'.repeat(64);
const where=(post:string)=>({action:'PROVIDER_RESERVED',entityType:'ProviderBudget',entityId:'gemini',AND:[{metadata:{path:['postId'],equals:post}},{metadata:{path:['key'],equals:key}}]});
test('concurrent partial expression index preserves Prisma lifetime counts and supports zero/existing lookups at Production-like volume',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 assert.equal(new URL(process.env.TEST_DATABASE_URL!).hostname,'127.0.0.1');
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL,log:[{emit:'event',level:'query'}]});let sql='';let duration=0;
 db.$on('query',e=>{if(e.query.startsWith('SELECT COUNT(*)')&&e.query.includes('AuditLog')){sql=e.query;duration=e.duration;}});
 try{
  await db.$executeRawUnsafe('DROP INDEX IF EXISTS "'+index+'"');
  await db.$executeRawUnsafe(`INSERT INTO "AuditLog" (id,level,action,"entityType","entityId",message,metadata,"createdAt")
   SELECT 'index-fixture-'||g,'INFO',CASE WHEN g<=6780 THEN 'PROVIDER_RESERVED' ELSE 'OTHER' END,
   CASE WHEN g<=31193 THEN 'ProviderBudget' ELSE 'SourcePost' END,CASE WHEN g<=31193 THEN 'gemini' ELSE 'fixture-'||g END,'offline',
   jsonb_build_object('postId','fixture-'||g,'key',md5(g::text)||md5(g::text),'payload',repeat('x',400)),now()-interval '6 days'
   FROM generate_series(1,152319) g`);
  for(const age of [0,2,30])await db.auditLog.create({data:{action:'PROVIDER_RESERVED',entityType:'ProviderBudget',entityId:'gemini',message:'offline lifetime',metadata:{postId,key},createdAt:new Date(Date.now()-age*86400000)}});
  await db.$executeRawUnsafe('ANALYZE "AuditLog"');
  const before=[await db.auditLog.count({where:where(postId)}),await db.auditLog.count({where:where('absent')})];const beforeMs=duration;
  assert.deepEqual(before,[3,0]);assert(sql.includes('#>ARRAY'));
  // Raw-query string bindings need the JSONB types Prisma supplies natively.
  const explain=async(post:string)=>db.$queryRawUnsafe('EXPLAIN (FORMAT JSON) '+sql.replace('$5','$5::jsonb').replace('$7','$7::jsonb'),'PROVIDER_RESERVED','ProviderBudget','gemini','postId',JSON.stringify(post),'key',JSON.stringify(key),0);
  const beforePlan=await explain(postId);
  await db.$executeRawUnsafe(migration);
  await db.$executeRawUnsafe('ANALYZE "AuditLog"');
  for(let i=0;i<10;i++){assert.equal(await db.auditLog.count({where:where(postId)}),3);assert.equal(await db.auditLog.count({where:where('absent')}),0);}
  const afterMs=duration;const plans=[await explain(postId),await explain('absent')];for(const plan of plans)assert(JSON.stringify(plan).includes(index));
  const state=await db.$queryRawUnsafe<{indisvalid:boolean;indisready:boolean;bytes:bigint}[]>(`SELECT indisvalid,indisready,pg_relation_size(indexrelid) bytes FROM pg_index WHERE indexrelid='"AuditLog_provider_reservation_attempt_idx"'::regclass`);
  assert(state[0].indisvalid&&state[0].indisready);
  console.log(JSON.stringify({rows:152322,before,after:[3,0],beforeMs,afterMs,indexBytes:Number(state[0].bytes),beforePlan,afterPlans:plans}));
 }finally{await db.$disconnect();}
});
