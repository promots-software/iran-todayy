import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ingest, claimJob, processJob, json, pollSources } from "../src/lib/processing/engine";
import { FixtureMonitor, UnconfiguredLanguageProvider } from "../src/lib/processing/providers";
import { fixture, fixtureProvider, official, scenarios } from "./fixtures/processing";
import { pipelineOrder, ruleSet } from "../src/lib/processing/rules";
import { ProcessingError } from "../src/lib/processing/contracts";
test("Phase2 database pipeline: concurrency, multilingual identity, update, review, filters, leases and publication retry",{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=process.env.TEST_DATABASE_URL!;
  assert.ok(["localhost","127.0.0.1"].includes(new URL(url).hostname),"Phase2 mutation suite requires isolated local PostgreSQL");
  const db=new PrismaClient({datasourceUrl:url});const signal=new AbortController().signal;
  const tag=randomUUID().replaceAll("-","").slice(0,8);const sourceIds:string[]=[];
  const started=new Date();
  const sport=fixture("sport","إعلان تجاري عن متجر في طهران","ar","إعلان تجاري عن متجر في طهران");sport.understanding.relevance="IRRELEVANT";sport.understanding.filterReason="ADVERTISING";
  const uncovered=fixture("uncovered","ظهر مصطلح سياسي جديد في طهران","ar","ظهر مصطلح سياسي جديد في طهران");uncovered.understanding.uncoveredTerms=["مصطلح سياسي جديد"];
  const figures=fixture("figures","وردت أنباء عن 5 ضحايا في طهران","ar","وردت أنباء عن 5 ضحايا في طهران");figures.understanding.event.facts[0].kind="FIGURE";
  const records=[...scenarios,sport,uncovered,figures];const provider=fixtureProvider(records);
  async function createSource(platform:"TELEGRAM"|"X",i:number){const s=await db.source.create({data:{platform,handle:`p2${tag}${i}`,name:"اختبار المرحلة الثانية",url:`https://${platform === "X"?"x.com":"t.me"}/p2${tag}${i}`,editorialProfile:json(official)}});sourceIds.push(s.id);return s;}
  async function incoming(sourceId:string,id:string,index=0){const f=records.find(r=>r.id===id)!;const post=await ingest(db,sourceId,{externalId:id,url:`https://t.me/fixture/${index+1}`,content:f.content,publishedAt:new Date("2026-08-10T10:00:00Z"),metadata:{fixture:id}});
    // Local DB timestamps may round 1ms ahead of the JS clock. Make fixture jobs
    // explicitly due; concurrency assertions must not depend on that clock race.
    await db.processingJob.updateMany({where:{sourcePostId:post.id,status:"PENDING"},data:{availableAt:new Date(0)}});return post;}
  async function run(){const job=await claimJob(db,"test-worker");assert.ok(job);const result=await processJob(db,job,provider,signal);assert.ok(!("error" in result),JSON.stringify(result));return db.sourcePost.findUniqueOrThrow({where:{id:job.sourcePostId},include:{matches:true}});}
  try {
    const a=await createSource("TELEGRAM",1),b=await createSource("TELEGRAM",2),x=await createSource("X",3);
    await incoming(a.id,"telegram-a");await incoming(b.id,"telegram-b");
    const jobs=await Promise.all([claimJob(db,"worker-a"),claimJob(db,"worker-b")]);assert.ok(jobs[0]&&jobs[1]);assert.notEqual(jobs[0].id,jobs[1].id);
    await Promise.all(jobs.map(j=>processJob(db,j!,provider,signal)));
    const first=await db.sourcePost.findMany({where:{sourceId:{in:[a.id,b.id]}},include:{matches:{include:{eventRevision:true}}}});
    assert.equal(new Set(first.flatMap(p=>p.matches.map(m=>m.eventRevision.eventId))).size,1,"simultaneous reports share a canonical event");
    assert.equal(first.filter(p=>p.status === "DUPLICATE").length,1);
    for (const [id,source] of [["x-a",x],["english",b],["persian",a],["rewrite",b]] as const){await incoming(source.id,id);assert.equal((await run()).status,"DUPLICATE",id);}
    await incoming(a.id,"update");const updated=await run();assert.equal(updated.matches[0].classification,"MATERIAL_UPDATE");
    assert.equal((await db.eventRevision.findUniqueOrThrow({where:{id:updated.matches[0].eventRevisionId}})).revision,2);
    await incoming(a.id,"different");assert.equal((await run()).matches[0].classification,"NEW_EVENT");
    await incoming(a.id,"uncertain");const uncertain=await run();assert.equal(uncertain.status,"NEEDS_REVIEW");assert.ok(uncertain.matches.every(m=>m.classification === "UNCERTAIN_MATCH"));
    const count=await db.canonicalEvent.count();
    const original=await incoming(a.id,"telegram-a");const retry=await incoming(a.id,"telegram-a");assert.equal(original.id,retry.id);assert.equal(await claimJob(db,"retry"),null);
    assert.equal(await db.canonicalEvent.count(),count);
    await assert.rejects(db.sourcePost.update({where:{id:original.id},data:{originalContent:"changed"}}));
    await incoming(a.id,"sport");assert.equal((await run()).status,"FILTERED");
    await incoming(a.id,"uncovered");assert.equal((await run()).status,"NEEDS_REVIEW");
    await db.source.update({where:{id:b.id},data:{editorialProfile:json({...official,authority:"NEWSPAPER"})}});
    await incoming(b.id,"figures");const figurePost=await run();assert.match(JSON.stringify(figurePost.processingResult),/SINGLE_UNOFFICIAL_FIGURE/);
    const news=await db.newsItem.findFirstOrThrow({where:{evidence:{some:{sourcePost:{sourceId:a.id}}}}});
    const intent={newsItemId:news.id,idempotencyKey:`test:${tag}:event`,destination:"fixture-only",contentSnapshot:"fixture"};
    const attempts=await Promise.allSettled([db.publication.create({data:intent}),db.publication.create({data:intent})]);assert.equal(attempts.filter(a=>a.status === "fulfilled").length,1);
    const publication=await db.publication.findUniqueOrThrow({where:{newsItemId:news.id}});
    await db.publication.update({where:{id:publication.id},data:{status:"UNKNOWN"}});
    await db.publicationAttempt.create({data:{publicationId:publication.id,attempt:1}});
    await assert.rejects(db.publicationAttempt.create({data:{publicationId:publication.id,attempt:1}}));
    assert.equal(await db.publication.count({where:{createdAt:{gte:started}}}),1,"engine itself never creates publication intents");
    const ordered=await db.auditLog.findMany({where:{entityId:updated.id},orderBy:{createdAt:"asc"}});assert.deepEqual(ordered.map(l=>l.action),["PROCESSING_ATTEMPT_STARTED",...pipelineOrder,'PROCESSING_ATTEMPT_FINISHED','PROCESSING_DECISION_COMMITTED']);
    assert.ok(await db.editorialRuleSet.findUnique({where:{version:ruleSet.version}}));
    // New enabled Sources enter poll without a hardcoded handle list; cursor replay is idempotent.
    const monitor=new FixtureMonitor({[x.handle]:[{externalId:"poll",content:scenarios[0].content,publishedAt:new Date("2026-08-10T10:00:00Z"),url:"https://x.com/fixture/status/99",metadata:{}}]});
    await pollSources(db,{X:monitor},signal);await pollSources(db,{X:monitor},signal);
    assert.equal(await db.sourcePost.count({where:{sourceId:x.id,sourcePostId:"poll"}}),1);
    const stale=await claimJob(db,"stale");assert.ok(stale);
    await db.processingJob.update({where:{id:stale.id},data:{lockedAt:new Date(Date.now()-600000)}});
    const recovered=await claimJob(db,"recovered");assert.ok(recovered);assert.notEqual(recovered.lockedBy,stale.lockedBy);
    const staleResult = await processJob(db,stale,provider,signal);
    assert.ok("error" in staleResult);assert.equal(staleResult.error,"STALE_CLAIM");
    assert.equal((await db.processingJob.findUniqueOrThrow({where:{id:recovered.id}})).lockedBy,recovered.lockedBy);
    const transient={...provider,id:"failure",live:false,understand:async()=>{throw new ProcessingError("TRANSIENT",true);},draft:provider.draft.bind(provider),compare:provider.compare.bind(provider)};
    await processJob(db,recovered,transient,signal);
    const retryJob=await db.processingJob.findUniqueOrThrow({where:{id:recovered.id}});assert.equal(retryJob.status,"RETRY");assert.ok(retryJob.availableAt>new Date());
    await db.processingJob.update({where:{id:retryJob.id},data:{availableAt:new Date(0)}});
    const unavailable=await claimJob(db,"no-provider");assert.ok(unavailable);
    await processJob(db,unavailable,new UnconfiguredLanguageProvider(),signal);
    assert.equal((await db.sourcePost.findUniqueOrThrow({where:{id:unavailable.sourcePostId}})).status,"NEEDS_REVIEW");
  } finally {
    const posts=await db.sourcePost.findMany({where:{sourceId:{in:sourceIds}},select:{id:true}});const ids=posts.map(p=>p.id);
    const revisions=await db.eventRevision.findMany({where:{event:{createdAt:{gte:started}}},select:{id:true,eventId:true}});const rids=revisions.map(r=>r.id);
    const items=await db.newsItem.findMany({where:{eventRevisionId:{in:rids}},select:{id:true}});const nids=items.map(n=>n.id);
    await db.publicationAttempt.deleteMany({where:{publication:{newsItemId:{in:nids}}}});
    await db.publication.deleteMany({where:{newsItemId:{in:nids}}});
    await db.newsEvidence.deleteMany({where:{OR:[{sourcePostId:{in:ids}},{newsItemId:{in:nids}}]}});
    await db.eventMatch.deleteMany({where:{sourcePostId:{in:ids}}});await db.newsItem.deleteMany({where:{id:{in:nids}}});
    await db.eventRevision.deleteMany({where:{id:{in:rids}}});await db.canonicalEvent.deleteMany({where:{id:{in:revisions.map(r=>r.eventId)}}});
    await db.processingJob.deleteMany({where:{sourcePostId:{in:ids}}});await db.sourcePost.deleteMany({where:{id:{in:ids}}});await db.source.deleteMany({where:{id:{in:sourceIds}}});
    await db.auditLog.deleteMany({where:{entityId:{in:ids}}});await db.$disconnect();
  }
});
