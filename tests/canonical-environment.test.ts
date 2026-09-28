/* eslint-disable @typescript-eslint/no-explicit-any -- Offline Prisma doubles only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalPipelineEnabled,usesCanonicalPipeline,assertCanonicalEnvironment} from '../src/lib/canonical-environment';
import {assertStagingDestination} from '../src/lib/telegram/staging-guard';
import {processJob} from '../src/lib/processing/engine';
import {canonicalPublicationFacts} from '../src/lib/telegram/canonical-publication';
import {publicationReady,eligibleAutomatic} from '../src/lib/telegram/publication-policy';

const source='الحكومة الإيرانية تعلن سياسة اقتصادية جديدة لتنظيم صادرات النفط.';
const at=new Date('2026-09-28T00:00:00Z');
test('explicit environment matrix never grants capability from a destination or AUTO flag',()=>{
 for(const name of ['staging','production','development','test','other','',undefined]){
  const env={IRAN_TODAY_ENVIRONMENT:name,TELEGRAM_CHAT_ID:'-1004297263933',AUTO_PUBLISH:'false'};
  const allowed=name==='staging'||name==='production';
  assert.equal(canonicalPipelineEnabled(env),allowed);assert.equal(usesCanonicalPipeline({live:true,generationFirst:true,canonicalRequest:()=>{}},env),allowed);
  if(allowed){assert.doesNotThrow(()=>assertCanonicalEnvironment(env));assert.throws(()=>usesCanonicalPipeline({live:true},env),/CANONICAL_PROVIDER_REQUIRED/);}else assert.throws(()=>assertCanonicalEnvironment(env),/CANONICAL_ENVIRONMENT_REQUIRED/);
  assert.equal(env.IRAN_TODAY_ENVIRONMENT,name);assert.equal(env.AUTO_PUBLISH,'false');
 }
});
test('both identities reject missing, other and cross-environment destinations',()=>{
 for(const [identity,destination,code] of [['staging','-1004436536617','STAGING_DESTINATION_REJECTED'],['production','-1004297263933','PRODUCTION_DESTINATION_REJECTED']]){
  assert.doesNotThrow(()=>assertStagingDestination({IRAN_TODAY_ENVIRONMENT:identity,TELEGRAM_CHAT_ID:destination}));
  for(const wrong of [undefined,'','-100123',identity==='staging'?'-1004297263933':'-1004436536617'])assert.throws(()=>assertStagingDestination({IRAN_TODAY_ENVIRONMENT:identity,TELEGRAM_CHAT_ID:wrong}),new RegExp(code));
 }
});
async function run(identity:string,mode:'NORMAL'|'DIRECT',value='KEEP',related=true){
 const previous=process.env.IRAN_TODAY_ENVIRONMENT;process.env.IRAN_TODAY_ENVIRONMENT=identity;
 const stages:any[]=[],audits:any[]=[],items:any[]=[];let saved:any={},jobState:any={status:'RUNNING',lockedBy:'fixture',lockedAt:new Date()};
 const event={actors:[],action:null,object:null,location:null,eventTime:null,summary:source,facts:[]};
 const src={id:'source',enabled:true,deletedAt:null,processingMode:mode,platform:'TELEGRAM'};
 const post:any={id:'post',sourceId:'source',source:src,originalContent:source,normalizedContent:source,sourcePublishedAt:at,modeAtProcessing:'REQUIRE_APPROVAL',processingStartedAt:at,ingestedAt:at};
 const db:any={
  $queryRaw:async(sql:any)=>String(sql?.sql??'').includes('WITH documents')?[{digest:'offline-'+identity,payload:{id:'old-event',createdAt:at.toISOString(),revisionId:'old-revision',revision:1,facts:event,publishedAt:at.toISOString(),published:false}}]:[],
  processingJob:{findUniqueOrThrow:async()=>jobState,update:async({data}:any)=>{jobState={...jobState,...data};return jobState;}},
  source:{findUniqueOrThrow:async()=>src},
  sourcePost:{update:async({data}:any)=>{saved={...saved,...data};return {...post,...saved};}},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},
  editorialRuleSet:{upsert:async()=>({id:'rules'})},
  canonicalEvent:{create:async()=>({id:'new-event',revisions:[{id:'new-revision'}]})},
  newsItem:{create:async({data}:any)=>{const item={id:'news',...data};items.push(item);return item;},updateMany:async()=>({count:0})},
  newsEvidence:{upsert:async()=>({})},eventMatch:{upsert:async()=>({})}
 };db.$transaction=async(fn:any)=>fn(db);
 const noLegacy=async()=>{throw Error('LEGACY_CALLED')};
 const provider:any={id:'offline',live:false,generationFirst:true,understand:noLegacy,draft:noLegacy,compare:noLegacy,canonicalRequest:async(r:any)=>{
  stages.push({stage:r.stage,instructions:r.instructions});
  if(r.stage==='canonical_intake')return {iranRelated:related,rationale:'source',newsValue:value,newsValueRationale:'material economy'};
  if(r.stage==='canonical_generate')return {title:'إيران الآن | سياسة اقتصادية إيرانية جديدة',body:source};
  if(r.stage==='canonical_check')return {sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:'PASS',defects:[]}]))};
  if(r.stage==='canonical_match')return {snapshot:r.input.snapshot,assessmentComplete:true,matches:[]};
  throw Error('UNEXPECTED_STAGE');
 }};
 try{
  const result=await processJob(db,{id:'job',sourcePostId:'post',sourcePost:post,lockedBy:'fixture',attemptCount:1,createdAt:at,availableAt:at} as any,provider,new AbortController().signal);
  assert(!('error' in result),JSON.stringify(result));assert.equal(process.env.IRAN_TODAY_ENVIRONMENT,identity);
  if(value==='KEEP'&&related){
   assert.deepEqual(stages.map(x=>x.stage),['canonical_intake','canonical_generate','canonical_check','canonical_match']);
   assert.equal(items.length,1);assert.equal(items[0].status,'PENDING_APPROVAL');assert.equal(items[0].modeAtProcessing,'REQUIRE_APPROVAL');
   assert(audits.some(x=>x.action==='CANONICAL_MATCH_RETRIEVAL'));assert.equal(saved.processingResult.classification,'NEW_EVENT');
   const item:any={...items[0],createdAt:at,error:null,rejectionReason:null,humanDraft:null,publication:null,eventRevision:{facts:saved.processingResult.extraction.event},evidence:[{sourcePostId:'post',sourcePost:{...post,...saved,jobs:[{status:'COMPLETED'}],matches:[{eventRevisionId:'new-revision',classification:'NEW_EVENT'}]}}]};
   assert(canonicalPublicationFacts(item));assert.equal(publicationReady(item),true);
   assert.equal(eligibleAutomatic(item,{state:'CLOSED'} as any),false);
   assert.equal(publicationReady({...item,humanDraft:{id:'human'}}),false);
   assert.throws(()=>canonicalPublicationFacts({...item,title:'تغيير غير معتمد'}),/CANONICAL_APPROVAL_CHANGED/);
  }else{assert.deepEqual(stages.map(x=>x.stage),['canonical_intake']);assert.equal(items.length,0);assert.equal(saved.rejectionReason,related?'LOW_NEWS_VALUE':'UNRELATED_TO_IRAN');}
  return {stages,status:saved.status,reason:saved.rejectionReason,classification:saved.processingResult.classification};
 }finally{if(previous===undefined)delete process.env.IRAN_TODAY_ENVIRONMENT;else process.env.IRAN_TODAY_ENVIRONMENT=previous;}
}
for(const mode of ['NORMAL','DIRECT'] as const)for(const [value,related] of [['KEEP',true],['LOW_NEWS_VALUE',true],['KEEP',false]] as const)test(mode+' staging/production engine and publication parity '+value+' '+related,async()=>{
 assert.deepEqual(await run('staging',mode,value,related),await run('production',mode,value,related));
});
test('runtime provider setup and processing dispatcher share centralized capability',()=>{
 assert(readFileSync('src/worker/production.ts','utf8').includes('},canonicalPipelineEnabled()),databaseCheckpoints'));
 assert(readFileSync('src/lib/processing/engine.ts','utf8').includes('if(usesCanonicalPipeline(provider))return await runCanonicalJob'));
});
