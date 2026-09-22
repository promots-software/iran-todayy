import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {unknownProfile} from '../src/lib/processing/contracts';
import {verifyPassword} from '../src/lib/dashboard-auth';

test('fresh bootstrap creates only authorized configuration; closed policy; immutable on rerun',async()=>{
 const url=process.env.TEST_DATABASE_URL;
 assert.ok(url&&new URL(url).hostname==='127.0.0.1','isolated local database required');
 const db=new PrismaClient({datasourceUrl:url});
 try{
  await db.appSettings.deleteMany();
  const file=join(mkdtempSync(join(tmpdir(),'fresh-bootstrap-')),'config.json');
  const sources=['testchannel','isna94','irna_ar','alalamarabic'].map((handle,i)=>({handle,name:handle,processingMode:i?'NORMAL':'DIRECT',editorialProfile:unknownProfile,cursor:{kind:'telegram-shadow-v1',channelId:String(i+1),lastId:100+i},capturedAt:new Date().toISOString()}));
  writeFileSync(file,JSON.stringify({sources,destination:'-1001234567890'}));
  const env={...process.env,DATABASE_URL:url,DIRECT_URL:url,ADMIN_PASSWORD:'offline-test-only-password'};
  const run=()=>spawnSync(process.execPath,['--import','tsx','scripts/initialize-fresh-database.ts','--confirm-fresh',file],{env,encoding:'utf8'});
  assert.equal(run().status,0);
  const settings=await db.appSettings.findUniqueOrThrow({where:{id:1}});
  const policy=settings.telegramAutoPolicy as {state:string;sourceIds:string[]};
  assert.equal(policy.state,'CLOSED');assert.equal(policy.sourceIds.length,4);
  assert.equal(settings.publishingMode,'REQUIRE_APPROVAL');assert.equal(settings.publishingPaused,false);
  assert.equal((await db.source.findUniqueOrThrow({where:{platform_handle:{platform:'TELEGRAM',handle:'testchannel'}}})).processingMode,'DIRECT');
  for(const count of await Promise.all([db.sourcePost.count(),db.newsItem.count(),db.publication.count(),db.publicationAttempt.count(),db.processingJob.count()]))assert.equal(count,0);
  const admin=await db.dashboardUser.findUniqueOrThrow({where:{username:'adel'}});
  assert.equal(admin.role,'SUPER_ADMIN');assert.ok(await verifyPassword('offline-test-only-password',admin.passwordHash));
  assert.equal(await db.auditLog.count({where:{action:'FRESH_DATABASE_INITIALIZED'}}),1);
  assert.equal(run().status,1);assert.equal(await db.source.count(),4);assert.equal(await db.dashboardUser.count(),1);
 }finally{await db.$disconnect();}
});
