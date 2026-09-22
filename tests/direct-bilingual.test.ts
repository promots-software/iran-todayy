import {PrismaClient} from '@prisma/client';
import {saveSource} from '../src/lib/source-service';
import {ingest,claimJob,processJob} from '../src/lib/processing/engine';
import {publishReadyDirect} from '../src/lib/telegram/direct-auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {ProcessingError,unknownProfile,validateUnderstanding} from '../src/lib/processing/contracts';
import {adaptDirectExtraction} from '../src/lib/processing/direct';
import {bilingualInstructions,prepareDirectBilingual,finalizeDirectBilingual,assertDirectFullCoverage,sourceCoverageUnits} from '../src/lib/processing/direct-bilingual';
import {ruleSet} from '../src/lib/processing/rules';
import {checkpointCall,checkpointProvider,type CheckpointStore} from '../src/worker/checkpoints';
import {bilingualFixture,passingReview,geminiEnvelope} from './fixtures/direct-bilingual';
const signal=()=>new AbortController().signal;
test('combined instructions permit attached Arabic without asking for generated IDs or a second output format',()=>{assert.ok(!bilingualInstructions.includes('Do not generate summary, translations'));assert.ok(!bilingualInstructions.includes('Return only id and arabic'));assert.ok(bilingualInstructions.includes('IDs are assigned locally'));});
const input=(content:string)=>({content,publishedAt:new Date('2026-09-21T10:00:00Z'),profile:unknownProfile,rules:ruleSet,processingMode:'DIRECT' as const});
for(const language of ['fa','en'] as const)test(`DIRECT ${language}: exactly two calls, no classifier, full source and validated offsets in independent review`,async()=>{
 const f=bilingualFixture(language),p=prepareDirectBilingual(f.raw,f.source);let calls=0;
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{
 const request=JSON.parse(String(init?.body)),data=JSON.parse(request.contents[0].parts[0].text),schema=request.generationConfig.responseJsonSchema;calls++;
 assert.equal(request.generationConfig.maxOutputTokens,4096);assert.equal(schema.properties.relevance,undefined);assert.equal(schema.properties.topic,undefined);
 if(calls===1){assert.equal(data.content,f.source);assert.equal(schema.properties.actors.items.properties.arabic.type,'string');return Response.json(geminiEnvelope(f.raw));}
 assert.equal(calls,2);assert.equal(data.originalSource,f.source);assert.deepEqual(data.validatedReferences,p.refs);assert.ok(data.validatedReferences.every((r:{evidence:{start:number;end:number;excerpt:string}})=>f.source.slice(r.evidence.start,r.evidence.end)===r.evidence.excerpt));assert.deepEqual(data.sourceUnits,sourceCoverageUnits(f.source));
 return Response.json(geminiEnvelope(passingReview(f.source,p)));});
 const u=validateUnderstanding(await provider.understand(input(f.source),signal()),f.source);assertDirectFullCoverage(f.source,u);
 await provider.draft({content:f.source,understanding:u,rules:ruleSet},signal());assert.equal(calls,2);assert.equal(u.event.facts[0].arabic,f.raw.statements[0].evidence.arabic);
});
test('Call 1 alone is not a trusted receipt and cannot supply an approved translation',()=>{
 const f=bilingualFixture(),p=prepareDirectBilingual(f.raw,f.source);assert.ok(!('review' in p.rendered));assert.throws(()=>adaptDirectExtraction(p.grounded,f.source),/VALIDATED_ARABIC_RENDERING_REQUIRED/);assert.throws(()=>finalizeDirectBilingual(f.source,p,{}),/INVALID_DIRECT_REVIEW_SCHEMA/);
});
test('material number, country/entity, date and quote failures still stop after at most one repair',async()=>{
 const f=bilingualFixture();
 for(const mutate of [
 (x:ReturnType<typeof bilingualFixture>['raw'])=>{x.statements[0].evidence.arabic='افتتح المجلس 13 مدرسة جديدة في العاصمة.';},
 (x:ReturnType<typeof bilingualFixture>['raw'])=>{x.statements[0].evidence.arabic='افتتحت الحكومة الأميركية 12 مدرسة جديدة في العاصمة.';},
 (x:ReturnType<typeof bilingualFixture>['raw'])=>{x.statements[0].evidence.arabic='«افتتح المجلس 12 مدرسة جديدة في العاصمة»';},
 ]){const raw=structuredClone(f.raw);mutate(raw);let calls=0;const provider=new GeminiLanguageProvider('offline',async()=>{calls++;return Response.json(geminiEnvelope(raw));});await assert.rejects(provider.understand(input(f.source),signal()));assert.equal(calls,2);}
 const source=f.source+' در ۱۲ مهر';const x=structuredClone(f.raw);for(const v of [...x.actors,x.action,x.object,x.location,x.statements[0].evidence])v.context=source;x.statements[0].evidence.excerpt=source;x.statements[0].evidence.arabic+=' في 12 حزيران';
 assert.throws(()=>prepareDirectBilingual(x,source),/MATERIAL_DATE_MISMATCH/);
});
test('independent semantic rejection blocks unsupported wording, relationships, dates and missing attribution',()=>{
 const f=bilingualFixture(),p=prepareDirectBilingual(f.raw,f.source);
 for(const key of ['scope','entitiesAndRelationships','namesAndTitles','numbers','attribution','negationAndModality','literalQuotes']){
 const review=passingReview(f.source,p);review.review[0].checks[key]=false;review.review[0].verdict='UNSUPPORTED';review.review[0].issues=['Unsupported semantic addition or omission'];assert.throws(()=>finalizeDirectBilingual(f.source,p,review),/UNVALIDATED_ARABIC_RENDERING/);
 }
 const added=structuredClone(f.raw);added.statements[0].evidence.arabic+=' بأمر من الحكومة';const q=prepareDirectBilingual(added,f.source),review=passingReview(f.source,q);review.review.find(r=>r.id==='f1')!.verdict='UNSUPPORTED';assert.throws(()=>finalizeDirectBilingual(f.source,q,review),/UNVALIDATED_ARABIC_RENDERING/);
});
test('speaker evidence is immutable and missing explicit attribution requires independent rejection',()=>{
 const source='سخنگو گفت: شورا ۱۲ مدرسه جدید را در پایتخت افتتاح کرد.';const x=bilingualFixture().raw;for(const v of [...x.actors,x.action,x.object,x.location,x.statements[0].evidence])v.context=source;
 const speaker={excerpt:'سخنگو',context:source,arabic:'المتحدث'};
 const withSpeaker={...x,statements:[{...x.statements[0],kind:'STATEMENT',speaker}]};const p=prepareDirectBilingual(withSpeaker,source);assert.equal(p.refs.find(r=>r.role==='speaker')!.evidence.excerpt,'سخنگو');
 const wrong={...withSpeaker,statements:[{...withSpeaker.statements[0],speaker:{...speaker,excerpt:'پایتخت'}}]};assert.throws(()=>prepareDirectBilingual(wrong,source),/SPEAKER_ATTRIBUTION_MISMATCH/);
 const omitted=prepareDirectBilingual(x,source),review=passingReview(source,omitted);review.coverage.complete=false;review.coverage.units[0].verdict='MISSING';review.coverage.units[0].reason='Explicit speaker omitted';assert.throws(()=>finalizeDirectBilingual(source,omitted,review),/MATERIAL_COVERAGE/);
});
test('full-source coverage cannot omit source units, invent IDs or claim completion with missing/uncertain material',()=>{
 const f=bilingualFixture(),source=f.source+'\nبودجه این طرح ۵ میلیون است.',p=prepareDirectBilingual(f.raw,source);
 const base=passingReview(source,p);
 for(const verdict of ['MISSING','UNCERTAIN']){const review=structuredClone(base);review.coverage.units[1].verdict=verdict;assert.throws(()=>finalizeDirectBilingual(source,p,review),/MATERIAL_COVERAGE/);}
 const dropped=structuredClone(base);dropped.coverage.units.pop();assert.throws(()=>finalizeDirectBilingual(source,p,dropped),/INVALID_DIRECT_REVIEW_SCHEMA/);
 const falseCovered=structuredClone(base);falseCovered.coverage.units[1].factIds=['f1'];assert.throws(()=>finalizeDirectBilingual(source,p,falseCovered),/COVERAGE_FACT_MISMATCH/);
 const denial=structuredClone(base);denial.coverage.units[0]={...denial.coverage.units[0],verdict:'NON_FACTUAL',factIds:[]};assert.throws(()=>finalizeDirectBilingual(source,p,denial),/COVERAGE_FACT_MISMATCH/);
 const incomplete=structuredClone(base);incomplete.coverage.complete=false;assert.throws(()=>finalizeDirectBilingual(source,p,incomplete),/MATERIAL_COVERAGE/);
});
for(const stage of [1,2])for(const failure of ['truncated','json','schema'])test(`Call ${stage} ${failure} fails closed without continuation`,async()=>{
 const f=bilingualFixture(),p=prepareDirectBilingual(f.raw,f.source);let calls=0;
 const provider=new GeminiLanguageProvider('offline',async()=>{calls++;if(calls!==stage)return Response.json(geminiEnvelope(f.raw));
 if(failure==='truncated')return Response.json(geminiEnvelope(stage===1?f.raw:passingReview(f.source,p),'MAX_TOKENS'));
 if(failure==='schema')return Response.json(geminiEnvelope({}));
 const envelope=geminiEnvelope({});envelope.candidates[0].content.parts[0].text='{"incomplete"';return Response.json(envelope);});
 await assert.rejects(provider.understand(input(f.source),signal()));assert.equal(calls,stage);
});
test('successful combined call replays locally after recoverable review failure; no repeated generation',async()=>{
 const f=bilingualFixture(),p=prepareDirectBilingual(f.raw,f.source),entries=new Map<string,{output:unknown}|{pending:true}>();
 const store:CheckpointStore={load:async k=>entries.get(k)??null,start:async k=>{entries.set(k,{pending:true});},finish:async(k,v)=>{entries.set(k,{output:v});},fail:async(k,_code,safe)=>{if(safe)entries.delete(k);}};
 let generations=0,reviews=0;
 const transport:typeof fetch=async(url,init)=>{let network=false;const key=createHash('sha256').update(String(url)+String(init?.body)).digest('hex');const result=await checkpointCall(store,key,async()=>{network=true;const req=JSON.parse(String(init?.body)),data=JSON.parse(req.contents[0].parts[0].text);if(data.originalSource){reviews++;if(reviews===1)throw new ProcessingError('GEMINI_HTTP_503',true);return geminiEnvelope(passingReview(f.source,p));}generations++;return geminiEnvelope(f.raw);});return Response.json(result,{headers:{'x-worker-checkpoint-replayed':String(!network)}});};
 const provider=()=>checkpointProvider(new GeminiLanguageProvider('offline',transport),store);
 await assert.rejects(provider().understand(input(f.source),signal()),/GEMINI_HTTP_503/);const u=validateUnderstanding(await provider().understand(input(f.source),signal()),f.source);assertDirectFullCoverage(f.source,u);assert.equal(generations,1);assert.equal(reviews,2);
 const absent=structuredClone(u);delete absent.rendering!.fullSourceCoverage;assert.throws(()=>assertDirectFullCoverage(f.source,absent),/COVERAGE_REQUIRED/);
});

test('bilingual candidate cannot auto-deliver without full coverage; valid receipt reuses frozen idempotent path',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const env={AUTO_PUBLISH:'true',REQUIRE_APPROVAL:'true',SHADOW_MODE:'false',TELEGRAM_PUBLISH_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:offline_token',TELEGRAM_CHAT_ID:'-100123'};
 try{
 const src=await saveSource(db,{platform:'TELEGRAM',handle:'bilingualoffline',name:'offline',processingMode:'DIRECT'},'user:admin');await db.source.update({where:{id:src.id},data:{editorialProfile:{...unknownProfile,verified:true,classification:'NEUTRAL',authority:'AGENCY'}}});
 const f=bilingualFixture(),p=prepareDirectBilingual(f.raw,f.source),post=await ingest(db,src.id,{externalId:'1',url:src.url+'/1',content:f.source,publishedAt:new Date()});const job=await claimJob(db,'bilingual');assert.ok(job);
 let calls=0;await processJob(db,job,new GeminiLanguageProvider('offline',async()=>{calls++;return Response.json(geminiEnvelope(calls===1?f.raw:passingReview(f.source,p)));}),signal());assert.equal(calls,2);
 const item=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePostId:post.id}}}});assert.equal(item.validationStatus,'PASSED');
 await db.appSettings.update({where:{id:1},data:{telegramAutoPolicy:{version:'telegram-auto-v1',id:'11111111-1111-4111-8111-111111111111',state:'ACTIVE',destination:env.TELEGRAM_CHAT_ID,notBefore:new Date(Date.now()-60000).toISOString(),sourceIds:[src.id],canaryCandidateId:null,authorizedBy:'offline-owner'}}});
 let sends=0;const transport:typeof fetch=async()=>{sends++;return Response.json({ok:true,result:{message_id:88,chat:{id:-100123}}});};
 await assert.rejects(publishReadyDirect(db,item.id,{...env,AUTO_PUBLISH:'false'},transport),/DIRECT_AUTO_DISABLED/);
 const original=(await db.sourcePost.findUniqueOrThrow({where:{id:post.id}})).processingResult!;
 const unreviewed=JSON.parse(JSON.stringify(original));delete unreviewed.extraction.rendering.fullSourceCoverage;await db.sourcePost.update({where:{id:post.id},data:{processingResult:unreviewed}});
 assert.equal((await publishReadyDirect(db,item.id,env,transport)).status,'NOT_ELIGIBLE');assert.equal(sends,0);
 await db.sourcePost.update({where:{id:post.id},data:{processingResult:original}});
 const results=await Promise.all([publishReadyDirect(db,item.id,env,transport),publishReadyDirect(db,item.id,env,transport)]);assert.equal(results.filter(r=>r.status==='SENT').length,1);assert.equal(sends,1);assert.equal(await db.publication.count({where:{destination:'WEB'}}),0);
 }finally{await db.$disconnect();}
});
test('source lines, speaker headings and non-factual footer retain exact full-source coverage',()=>{
 const source='سخنگو:\n🔹 شورا ۱۲ مدرسه جدید را در پایتخت افتتاح کرد.\n@channel',x=bilingualFixture().raw;
 for(const e of [...x.actors,x.action,x.object,x.location,x.statements[0].evidence])e.context=source;
 const raw={...x,statements:[{...x.statements[0],kind:'STATEMENT',speaker:{excerpt:'سخنگو',context:source,arabic:'المتحدث'}}]};
 const p=prepareDirectBilingual(raw,source),review=passingReview(source,p);review.coverage.units[2]={id:'u3',verdict:'NON_FACTUAL',factIds:[],reason:'Channel handle only'};
 const receipt=finalizeDirectBilingual(source,p,review);assert.equal(receipt.fullSourceCoverage!.units.length,3);assert.deepEqual(receipt.fullSourceCoverage!.units[0].factIds,['f1']);
});
