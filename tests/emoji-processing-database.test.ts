import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {normalizeProcessingSource,processingSource} from '../src/lib/processing/processing-source';
import {AssumedPropositionGemini as GeminiLanguageProvider} from './fixtures/proposition-mock';
import {publicationUnits} from '../src/lib/processing/direct-publication';
import {renderingChecks} from '../src/lib/processing/rendering-contract';
import {supportedLedger} from './fixtures/fidelity-review';
import {official} from './fixtures/processing';
import {combinedFixture,reviewedFixture} from './fixtures/current-direct';
import {publicationCandidateInclude,publicationReady} from '../src/lib/telegram/publication-policy';
import {approvalDigest,freezeValidatedPublication} from '../src/lib/telegram/publisher';

const raw='🔴 عباس عراقجي يزور طهران في زيارة رسمية.';
const canonical=normalizeProcessingSource(raw);
const envelope=(value:unknown)=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}});
const opts={skip:!process.env.TEST_DATABASE_URL};
function database(){const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,'127.0.0.1');return new PrismaClient({datasourceUrl:url});}
beforeEach(async()=>{if(opts.skip)return;const db=database();try{await db.$executeRawUnsafe('TRUNCATE TABLE "Source", "CanonicalEvent", "AuditLog" CASCADE');}finally{await db.$disconnect();}});
async function runCase(db:PrismaClient,mode:'NORMAL'|'DIRECT',sourceText=raw,metadata:Record<string,unknown>={}){
 const source=await db.source.create({data:{platform:'TELEGRAM',handle:randomUUID(),name:'offline',url:'https://t.me/offline',processingMode:mode,editorialProfile:official}});
 const post=await ingest(db,source.id,{externalId:'1',content:sourceText,publishedAt:new Date(),url:source.url+'/1',metadata});
 await db.processingJob.updateMany({where:{sourcePostId:post.id},data:{availableAt:new Date(0)}});
 const others=await db.processingJob.findMany({where:{sourcePostId:{not:post.id}},select:{sourcePostId:true}});
 const job=await claimJob(db,'emoji-offline',new Date(),false,others.map(x=>x.sourcePostId));assert(job);
 const text=normalizeProcessingSource(sourceText),stages:string[]=[],inputs:Record<string,unknown>[]=[];
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{
  const request=JSON.parse(String(init?.body)),props=request.generationConfig.responseJsonSchema.properties,data=JSON.parse(request.contents[0].parts[0].text);inputs.push(data);
  assert(!JSON.stringify(data).includes('🔴'));
  if(props.extraction){stages.push('combined');assert.equal(data.content,text);return envelope(combinedFixture(text,'', 'إيران الآن | '+text.replace(/\.$/u,'')));}
  if(props.contentType){stages.push('extract');assert.equal(data.content,text);return envelope({relevance:'POLITICAL_NEWS',contentType:(sourceText.includes('تابعوا')||sourceText==='شاهد التفاصيل عن إيران في الفيديو.')?'PURE_PROMO':'NEWS',contentTypeEvidence:{excerpt:text,context:text},actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence:{excerpt:text,context:text},speaker:null}],coverage:publicationUnits(text).map(u=>({unitId:u.id,nonFactual:false,factIds:['f1']}))});}
  if(props.anchorIds){stages.push('classify');assert(JSON.stringify(data).includes(text));return envelope({anchorIds:[],factLabels:[{id:'f1',kind:'FACT',material:false}],filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:['f1']});}
  if(props.publication){stages.push('draft');return envelope({publication:{title:{text:'إيران الآن | '+text.replace(/\.$/u,''),factIds:['f1']},body:[]},coverage:publicationUnits(text).map(u=>({unitId:u.id,nonFactual:false,factIds:['f1']}))});}
  stages.push('review');assert.equal(data.originalSource,text);
  return envelope(mode==='DIRECT'?reviewedFixture(text,data.publication):{fidelityLedger:supportedLedger(text,data.publication),review:data.publication.map((p:{id:string})=>({id:p.id,verdict:'SUPPORTED',checks:Object.fromEntries(renderingChecks.map(k=>[k,true])),issues:[]})),fullSourceCovered:true,publicationQuality:true,issues:[]});
 });
 provider.compare=async()=>({relation:'DIFFERENT',rationale:'حدث مستقل في اختبار محلي',newFactIds:[],conflictingFactIds:[]});
 const result=await processJob(db,job,provider,new AbortController().signal);
 return {post:await db.sourcePost.findUniqueOrThrow({where:{id:post.id}}),result,stages,inputs};
}
for(const mode of ['NORMAL','DIRECT'] as const)test('27/28 '+mode+' canonical source through extraction, classification/review and publisher',opts,async()=>{
 const db=database();try{
  const r=await runCase(db,mode);assert.equal('error' in r.result,false,JSON.stringify(r.result));
  assert.equal(r.post.originalContent,raw);assert.equal(r.post.normalizedContent,canonical);assert.equal(processingSource(r.post),canonical);
  assert(r.stages.includes('review'));assert.equal(r.stages.includes('classify'),mode==='NORMAL');
  const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:r.post.id}}},include:publicationCandidateInclude});
  assert(publicationReady(item),JSON.stringify({status:item.status,validation:item.validationResult,post:r.post.processingResult}));
  const invalid=structuredClone(item);invalid.evidence[0].sourcePost.originalContent=canonical;invalid.evidence[0].sourcePost.normalizedContent='wrong';assert.equal(publicationReady(invalid),false);invalid.evidence[0].sourcePost.normalizedContent='';assert.equal(publicationReady(invalid),false);
  const noCanonical=structuredClone(item);noCanonical.evidence[0].sourcePost.normalizedContent=null;assert.equal(publicationReady(noCanonical),false);
  const historical=structuredClone(item);historical.evidence[0].sourcePost.normalizedContent=null;historical.evidence[0].sourcePost.originalContent=canonical;assert(publicationReady(historical));
  const frozen=await db.$transaction(tx=>freezeValidatedPublication(tx,{newsItemId:item.id,digest:approvalDigest(item),resolutions:[]},'offline-human',{TELEGRAM_CHAT_ID:'-100123',TELEGRAM_BOT_TOKEN:'123:offline'},'TELEGRAM'));
  assert.equal(frozen.attemptCount,0);assert.equal(frozen.status,'PENDING');assert(!frozen.contentSnapshot.includes('🔴'));
  assert.equal(await db.publicationAttempt.count({where:{publicationId:frozen.id}}),0);
  assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:r.post.id}})).originalContent,raw);
 }finally{await db.$disconnect();}
});
test('31 emoji-only uses existing SOURCE_TEXT_REQUIRED with no provider stage',opts,async()=>{const db=database();try{const r=await runCase(db,'NORMAL','🔴👍🏽');assert.deepEqual(r.stages,[]);assert('error' in r.result);assert.equal(r.result.error,'SOURCE_TEXT_REQUIRED');assert.equal(r.post.originalContent,'🔴👍🏽');assert.equal(r.post.normalizedContent,'');}finally{await db.$disconnect();}});
test('32 emoji removal leaves promotional content filtered, no draft or publication',opts,async()=>{const db=database();try{const r=await runCase(db,'NORMAL','🔴 تابعوا الليلة برنامجاً عن إيران.');assert.equal(r.post.status,'FILTERED');assert.equal(r.post.rejectionReason,'NON_NEWS_PROMO');assert.deepEqual(r.stages,['extract']);assert.equal(await db.newsItem.count({where:{evidence:{some:{sourcePostId:r.post.id}}}}),0);}finally{await db.$disconnect();}});

for(const [name,metadata] of [
 ['complete text + image',{hasPhoto:true}],['complete text + video',{hasVideo:true}],['complete text + media metadata',{messageKind:'DOCUMENT',mediaType:'document'}],['partial caption with independently usable fact',{hasVideo:true,unseenDetails:'UNSEEN_MATERIAL_NEVER_SUPPLIED'}],
] as const)test('media text processing: '+name,opts,async()=>{const db=database();try{const text='افتتحت بلدية طهران مكتبة عامة في العاصمة الإيرانية.';const r=await runCase(db,'NORMAL',text,metadata);assert.equal('error'in r.result,false,JSON.stringify(r.result));const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:r.post.id}}},include:publicationCandidateInclude});assert(publicationReady(item));assert(!JSON.stringify(r.inputs).includes('UNSEEN_MATERIAL_NEVER_SUPPLIED'));assert(![item.title,item.arabicContent].join(' ').includes('UNSEEN_MATERIAL_NEVER_SUPPLIED'));assert.equal(await db.publication.count(),0);}finally{await db.$disconnect();}});
test('teaser dependent on unseen video supplies no invented news',opts,async()=>{const db=database();try{const r=await runCase(db,'NORMAL','شاهد التفاصيل عن إيران في الفيديو.',{hasVideo:true});assert.equal(r.post.status,'FILTERED');assert.deepEqual(r.stages,['extract']);assert.equal(await db.newsItem.count(),0);}finally{await db.$disconnect();}});
