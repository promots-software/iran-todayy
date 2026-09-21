import {assertDirectFullCoverage} from './direct-bilingual';
import {sourceMediaReviewRequired} from '../publication-media';
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { incomingSchema, sourceProfileSchema, unknownProfile, eventSchema, validateUnderstanding, ProcessingError, type LanguageProvider, type Monitor } from "./contracts";
import { editDraft, initialReview, reason } from "./editorial";
import { matchEvent, type Candidate } from "./matcher";
import { pipelineOrder, ruleSet } from "./rules";
import { retryDelay } from "../domain";
import { assertShadowMode, assertApprovalMode } from "./shadow";
import {finalizeConstrainedDraft} from './local-finalization';
import {sourceLanguage,detectSourceLanguage} from './source-language';
import {editorialDecision} from './editorial-eligibility';
import {editorialScope} from './editorial-scope';
import {failurePolicy,isProviderWait} from './failure-policy';
import {nextClaimSlot,oldestSlot} from '../../worker/newsroom-scheduler';
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const stage = "PROCESS_V1";
const leaseMs = 300000;
export type PollProgress = {sourceId:string;handle:string;phase:'READING'|'PERSISTING'|'COMPLETE'|'ERROR';posts:number;error:string|null;cursor?:unknown;durationMs:number};
export type PollSourcesOptions = {
  requireActive?: () => void;
  onProgress?: (progress:PollProgress) => void;
  now?: () => number;
};
const audit = (tx: Prisma.TransactionClient, id: string, action: string, message: string, metadata: unknown) => tx.auditLog.create({ data: { action, actor: "processing-engine", entityType: "SourcePost", entityId: id, message, metadata: json(metadata) } });
export async function ingest(client: PrismaClient, sourceId: string, raw: unknown, live = false) {
  if (live) assertShadowMode();
  const p=incomingSchema.parse(raw);
  return client.$transaction(async tx=>{
    const source=await tx.source.findUniqueOrThrow({where:{id:sourceId}});
    if (!source.enabled || source.deletedAt) throw new ProcessingError("SOURCE_DISABLED");
    if(!p.content.trim()&&!(source.platform==='TELEGRAM'&&p.metadata.transport==='telegram-shadow-v1'&&['MEDIA_ONLY','SERVICE','EMPTY'].includes(String(p.metadata.messageKind))))throw new ProcessingError('SOURCE_TEXT_REQUIRED');
    const mode=(await tx.appSettings.findUnique({where:{id:1}}))?.publishingMode ?? "REQUIRE_APPROVAL";
    if (live) {
      assertApprovalMode((await tx.appSettings.findUnique({where:{id:1}}))?.publishingMode);
      if (source.platform !== "TELEGRAM") throw new ProcessingError("LIVE_PLATFORM_DISABLED");
    }
    // Empty upsert update preserves the first received original, even if platform content edits.
    const post=await tx.sourcePost.upsert({where:{sourceId_sourcePostId:{sourceId,sourcePostId:p.externalId}},update:{},create:{sourceId,sourcePostId:p.externalId,sourceUrl:p.url,originalContent:p.content,sourcePublishedAt:p.publishedAt,metadata:json(p.metadata),contentHash:createHash("sha256").update(p.content).digest("hex"),modeAtProcessing:mode}});
    await tx.processingJob.upsert({where:{sourcePostId_stage:{sourcePostId:post.id,stage}},update:{},create:{sourcePostId:post.id,stage}});
    return post;
  });
}
export async function claimJob(client: PrismaClient, workerId: string, now=new Date(), telegramOnly=false, excludePostIds:string[] = [], newsroom=false, costRecheckBefore?:Date) {
  // A fresh opaque claim token fences stale processes after restart or lease recovery.
  const token=`${workerId}:${randomUUID()}`;
  return client.$transaction(async tx=>{
    let slot=0;
    if(newsroom){
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20916013)`;
      const previous=await tx.auditLog.findFirst({where:{action:'NEWSROOM_JOB_CLAIMED',entityType:'QueueScheduler',entityId:'newsroom'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{metadata:true}});
      slot=nextClaimSlot(Number((previous?.metadata as {slot?:number}|null)?.slot??-1));
    }
    const expired=await tx.processingJob.findMany({where:{stage,status:"RUNNING",lockedAt:{lt:new Date(now.getTime()-leaseMs)},...(telegramOnly?{sourcePost:{source:{platform:"TELEGRAM"}}}:{})}});
    for(const job of expired) {
      const exhausted=job.attemptCount>=job.maxAttempts;
      const reclaimed=await tx.processingJob.updateMany({where:{id:job.id,status:"RUNNING",lockedBy:job.lockedBy,lockedAt:job.lockedAt},data:{status:exhausted?"FAILED":"RETRY",lockedAt:null,lockedBy:null,availableAt:now,lastError:exhausted?"LEASE_EXHAUSTED":"LEASE_EXPIRED"}});
      if(reclaimed.count && exhausted)await tx.sourcePost.update({where:{id:job.sourcePostId},data:{status:"NEEDS_REVIEW",error:"LEASE_EXHAUSTED",nextRetryAt:null}});
    }
    const scope = telegramOnly ? Prisma.sql`AND EXISTS (SELECT 1 FROM "SourcePost" p JOIN "Source" s ON s."id" = p."sourceId" WHERE p."id" = "ProcessingJob"."sourcePostId" AND p."status" IN ('INGESTED','FAILED') AND s."platform" = 'TELEGRAM' AND s."enabled" = true AND s."deletedAt" IS NULL)` : Prisma.empty;
    const exclusions = excludePostIds.length ? Prisma.sql`AND "sourcePostId" NOT IN (${Prisma.join(excludePostIds)})` : Prisma.empty;
    const ordering=newsroom&&!oldestSlot(slot)?Prisma.sql`"createdAt" DESC,"id"`:Prisma.sql`"availableAt","createdAt","id"`;
    // Prisma stores DateTime as UTC timestamp-without-time-zone. A bound Date
    // is timestamptz in raw SQL; implicit conversion uses the DB session zone
    // and can claim future retries early. Compare explicit UTC wall timestamps.
    const due=costRecheckBefore ? Prisma.sql`("availableAt" <= CAST(${now.toISOString()} AS timestamp) OR ("status"='RETRY' AND "lastError"='PROVIDER_COST_WAIT' AND "updatedAt" < CAST(${costRecheckBefore.toISOString()} AS timestamp)))` : Prisma.sql`"availableAt" <= CAST(${now.toISOString()} AS timestamp)`;
    const rows=await tx.$queryRaw<{id:string;availableAt:Date;lastError:string|null}[]>`SELECT "id","availableAt","lastError" FROM "ProcessingJob" WHERE "stage" = ${stage} AND "status" IN ('PENDING','RETRY') AND ${due} AND "attemptCount" < "maxAttempts" ${scope} ${exclusions} ORDER BY ${ordering} FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    if(rows[0].lastError==='PROVIDER_COST_WAIT'&&rows[0].availableAt>now&&costRecheckBefore)await tx.auditLog.create({data:{action:'PROCESSING_COST_WAIT_RECHECKED',actor:workerId,entityType:'ProcessingJob',entityId:rows[0].id,message:'Normal single-job claim reconsidered an obsolete cost schedule; actual request guard still required',metadata:{previousAvailableAt:rows[0].availableAt.toISOString(),capacityObservedAt:costRecheckBefore.toISOString()}}});
    if(newsroom){
      // Transaction start time may precede an earlier holder of the lock.
      const [clock]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      await tx.auditLog.create({data:{createdAt:clock.now,action:'NEWSROOM_JOB_CLAIMED',actor:workerId,entityType:'QueueScheduler',entityId:'newsroom',message:'Durable 3 fresh / 1 oldest-due allocation',metadata:{slot,jobId:rows[0].id}}});
    }
    return tx.processingJob.update({where:{id:rows[0].id},data:{status:"RUNNING",lockedAt:now,lockedBy:token,attemptCount:{increment:1}},include:{sourcePost:{include:{source:true}}}});
  });
}
type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimJob>>>;

/** Only exact same-source text in the existing dedup window may skip AI.
 * A previous unvalidated/review failure is never a substitute for evidence. */
async function exactDirectDuplicate(client:PrismaClient,job:ClaimedJob,processingMode:string) {
 const post=job.sourcePost;
 return client.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "ProcessingJob" WHERE id=${job.id} FOR UPDATE`;
  const current=await tx.processingJob.findUniqueOrThrow({where:{id:job.id}});
  if(current.status!=='RUNNING'||current.lockedBy!==job.lockedBy||!current.lockedAt||current.lockedAt.getTime()+leaseMs<=Date.now())throw new ProcessingError('STALE_CLAIM');
  await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${post.sourceId} FOR SHARE`;
  const source=await tx.source.findUniqueOrThrow({where:{id:post.sourceId}});
  if(!source.enabled||source.deletedAt)throw new ProcessingError('SOURCE_DISABLED');
  if(source.processingMode!==processingMode)throw new ProcessingError('SOURCE_PROCESSING_MODE_CHANGED',true,undefined,1000);
  const prior=await tx.sourcePost.findFirst({where:{id:{not:post.id},sourceId:post.sourceId,contentHash:post.contentHash,originalContent:post.originalContent,
   sourcePublishedAt:{gte:new Date(post.sourcePublishedAt.getTime()-ruleSet.duplicateWindowHours*3600000),lte:post.sourcePublishedAt},
   processingResult:{path:['validated'],equals:true},error:null,matches:{some:{classification:{in:['NEW_EVENT','MATERIAL_UPDATE']}}}},include:{matches:true},orderBy:{ingestedAt:'asc'}});
  if(!prior)return false;
  const match=prior.matches.find(m=>['NEW_EVENT','MATERIAL_UPDATE'].includes(m.classification));
  if(!match)return false;
  await tx.eventMatch.upsert({where:{sourcePostId_eventRevisionId:{sourcePostId:post.id,eventRevisionId:match.eventRevisionId}},update:{},create:{sourcePostId:post.id,eventRevisionId:match.eventRevisionId,classification:'DUPLICATE',rationale:'تكرار حرفي من المصدر نفسه ضمن نافذة التطابق',evidence:json({previousSourcePostId:prior.id,exactText:true}),matcherVersion:'exact-source-v1'}});
  await tx.sourcePost.update({where:{id:post.id},data:{status:'DUPLICATE',error:null,nextRetryAt:null,relevance:prior.relevance,originalLanguage:prior.originalLanguage,processingResult:json({processingMode,validated:false,editorialEligibility:'FILTERED',classification:'DUPLICATE',deliveryDecision:'HOLD',previousSourcePostId:prior.id,review:[],externalPublishingEnabled:false})}});
  await tx.processingJob.update({where:{id:job.id},data:{status:'COMPLETED',lockedAt:null,lockedBy:null,lastError:null}});
  await audit(tx,post.id,'EXACT_SOURCE_DUPLICATE','Exact persisted source text; no provider request or publication',{processingMode,previousSourcePostId:prior.id,eventRevisionId:match.eventRevisionId});
  return true;
 });
}

async function eventSnapshot(db:Pick<Prisma.TransactionClient,'canonicalEvent'>){
 const events=await db.canonicalEvent.findMany({include:{revisions:{orderBy:{revision:'desc'},take:1,include:{newsItem:{include:{publication:true}},matches:{include:{sourcePost:true}}}}}});
 const candidates:Candidate[]=[];let legacy=0;
 for(const e of events){
  const revision=e.revisions[0],parsed=eventSchema.safeParse(revision?.facts);
  if(!revision||!parsed.success){legacy++;continue;}
  candidates.push({id:e.id,revisionId:revision.id,revision:revision.revision,data:parsed.data,publishedAt:revision.matches[0]?.sourcePost.sourcePublishedAt??e.createdAt,published:revision.newsItem?.publication?.status==='SENT'});
 }
 candidates.sort((a,b)=>a.id.localeCompare(b.id));
 return {candidates,legacy,key:createHash('sha256').update(JSON.stringify({candidates,legacy})).digest('hex')};
}
export async function processJob(client: PrismaClient,job:ClaimedJob,provider:LanguageProvider,signal:AbortSignal){
 const started=Date.now();
 const result=await runJob(client,job,provider,signal,0,started);
 // Observe completion AFTER the decision transaction resolves. PostgreSQL does
 // not expose its exact commit timestamp here; record a truthful post-commit
 // observation instead of a timestamp taken before comparisons/final writes.
 const committedAt=new Date();
 await audit(client,job.sourcePostId,'PROCESSING_ATTEMPT_FINISHED','Processing lane work completed',{jobId:job.id,claimToken:job.lockedBy,startedAt:new Date(started).toISOString(),finishedAt:committedAt.toISOString(),activeMs:committedAt.getTime()-started,firstEligibleAt:job.createdAt.toISOString(),attemptEligibleAt:job.availableAt.toISOString(),eligibleWaitMs:Math.max(0,started-job.availableAt.getTime()),error:'error' in result?result.error:null});
 const state=await client.processingJob.findUniqueOrThrow({where:{id:job.id}});
 const finished=(!('error' in result)&&state.status==='COMPLETED')||('error' in result&&state.status==='FAILED'&&state.lastError===result.error);
 if(finished)await client.$transaction(async tx=>{
  await tx.sourcePost.update({where:{id:job.sourcePostId},data:{processingEndedAt:committedAt}});
  // Never change timestamps on an older canonical story merely linked as a duplicate.
  await tx.newsItem.updateMany({where:{createdAt:{gte:new Date(started)},evidence:{some:{sourcePostId:job.sourcePostId}}},data:{processingEndedAt:committedAt}});
  await audit(tx,job.sourcePostId,'PROCESSING_DECISION_COMMITTED','Decision commit observed; not a pre-commit estimate',{jobId:job.id,committedObservedAt:committedAt.toISOString(),status:state.status});
 });
 return result;
}
async function runJob(client: PrismaClient, job: ClaimedJob, provider: LanguageProvider, signal: AbortSignal, snapshotRetry:number,attemptStartedAt:number):Promise<{postId:string;filtered:boolean}|{postId:string;error:string}> {
  const post=job.sourcePost;
  const profile=sourceProfileSchema.safeParse(post.source.editorialProfile);
  const sourceProfile=profile.success ? profile.data : unknownProfile;
  let processingMode=post.source.processingMode;
  try {
    signal.throwIfAborted();
    // Reject stale workers before spending a provider call, not only at commit.
    const active = await client.processingJob.findUniqueOrThrow({where:{id:job.id}});
    if (active.status !== "RUNNING" || active.lockedBy !== job.lockedBy || !active.lockedAt || active.lockedAt.getTime()+leaseMs <= Date.now()) throw new ProcessingError("STALE_CLAIM",true);
    const currentSource=await client.source.findUniqueOrThrow({where:{id:post.sourceId}});
    processingMode=currentSource.processingMode;
    const detectedLanguage=sourceLanguage(post.originalContent);
    await client.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "ProcessingJob" WHERE id=${job.id} FOR UPDATE`;
      const owner=await tx.processingJob.findUniqueOrThrow({where:{id:job.id}});
      if(owner.status!=='RUNNING'||owner.lockedBy!==job.lockedBy)throw new ProcessingError('STALE_CLAIM');
      await tx.sourcePost.update({where:{id:post.id},data:{processingStartedAt:post.processingStartedAt??new Date(attemptStartedAt),...(detectedLanguage!=='unknown'?{originalLanguage:detectedLanguage}:{})}});
      await audit(tx,post.id,'PROCESSING_ATTEMPT_STARTED','حفظ حالة المحاولة السابقة قبل المعالجة',{processingMode,attempt:job.attemptCount,language:detectSourceLanguage(post.originalContent),priorError:post.error,priorProcessingResult:post.processingResult});
    });
    if (provider.live) {
      assertShadowMode();
      assertApprovalMode((await client.appSettings.findUnique({where:{id:1}}))?.publishingMode);
      const source=await client.source.findUniqueOrThrow({where:{id:post.sourceId}});
      if (source.platform !== "TELEGRAM" || !source.enabled || source.deletedAt) throw new ProcessingError("LIVE_SOURCE_DISABLED");
    }
    if(processingMode==='DIRECT'&&!post.originalContent.trim())throw new ProcessingError('SOURCE_TEXT_REQUIRED');
    if(processingMode==='DIRECT') {
      const duplicate=await exactDirectDuplicate(client,job,processingMode);
      if(duplicate)return {postId:post.id,filtered:false};
    }
    const scope=processingMode==='DIRECT'?{status:'IN_SCOPE' as const,decision:'SOURCE_ADMIN_DIRECT'}:editorialScope(post.originalContent);
    if(scope.status!=='IN_SCOPE') {
      return await client.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "ProcessingJob" WHERE id=${job.id} FOR UPDATE`;
        const current=await tx.processingJob.findUniqueOrThrow({where:{id:job.id}});
        if(current.status!=='RUNNING'||current.lockedBy!==job.lockedBy||!current.lockedAt||current.lockedAt.getTime()+leaseMs<=Date.now())throw new ProcessingError('STALE_CLAIM');
        await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${post.sourceId} FOR SHARE`;
        const source=await tx.source.findUniqueOrThrow({where:{id:post.sourceId}});
        if(source.processingMode!==processingMode)throw new ProcessingError("SOURCE_PROCESSING_MODE_CHANGED",true,undefined,1000);
        if(!source.enabled||source.deletedAt)throw new ProcessingError('SOURCE_DISABLED');
        const filtered=scope.status==='OUT_OF_SCOPE',code=filtered?'OUTSIDE_EDITORIAL_SCOPE':'UNCERTAIN_SCOPE';
        await tx.sourcePost.update({where:{id:post.id},data:{status:filtered?'FILTERED':'NEEDS_REVIEW',rejectionReason:filtered?code:null,error:filtered?null:code,processingEndedAt:null,nextRetryAt:null,relevanceResult:json({scope,detectedLanguage}),processingResult:json({validated:false,editorialEligibility:filtered?'FILTERED':'NEEDS_REVIEW',deliveryDecision:'HOLD',scope,review:filtered?[]:[{code,detail:'لم تثبت صلة جغرافية واضحة بنطاق التغطية'}],externalPublishingEnabled:false})}});
        await tx.processingJob.update({where:{id:job.id},data:{status:'COMPLETED',lockedAt:null,lockedBy:null,lastError:null}});
        await audit(tx,post.id,'EDITORIAL_SCOPE',code,{scope,detectedLanguage,priorProcessingResult:post.processingResult});
        return {postId:post.id,filtered};
      });
    }
    const u=validateUnderstanding(await provider.understand({...(processingMode==='DIRECT'?{processingMode}:{}),content:post.originalContent,publishedAt:post.sourcePublishedAt,profile:sourceProfile,rules:ruleSet},signal),post.originalContent);
    if((await client.source.findUniqueOrThrow({where:{id:post.sourceId},select:{processingMode:true}})).processingMode!==processingMode)throw new ProcessingError('SOURCE_PROCESSING_MODE_CHANGED',true,undefined,1000);
    if(processingMode==='DIRECT')assertDirectFullCoverage(post.originalContent,u);
    // Assign provenance ourselves; never trust a provider-supplied database identity.
    for(const value of [...u.event.actors,u.event.action,u.event.object,u.event.location,u.event.eventTime,...u.event.facts,...u.event.facts.map(f=>f.speaker),...u.names]) if(value)value.evidence.sourcePostId=post.id;
    // Verify numeric evidence at extraction, before terminology (R IX.4).
    if(['SPORT','ENTERTAINMENT'].includes(u.filterReason))throw new ProcessingError('COVERAGE_CONTRACT_MISMATCH');
    const filter=u.relevance === "IRRELEVANT" || ["UNRELATED","ADVERTISING","SATIRE","RUMOUR","INCITEMENT"].includes(u.filterReason) || (u.filterReason === "OPINION" && !sourceProfile.approvedAnalyst);
    // Provider work must never hold the shared event-decision lock. Prepare
    // against an immutable snapshot, then recheck under the lock before commit.
    const snapshot=filter?null:await eventSnapshot(client);
    const preparedMatch=snapshot?await matchEvent(u.event,post.sourcePublishedAt,snapshot.candidates,provider,signal,{source:post.originalContent,understanding:u}):null;
    if(snapshot?.legacy&&preparedMatch?.classification==='NEW_EVENT'){preparedMatch.classification='UNCERTAIN_MATCH';preparedMatch.rationale='توجد أحداث قديمة بلا استخراج منظم؛ يلزم فحصها قبل إنشاء حدث جديد';preparedMatch.evidence={legacyEvents:snapshot.legacy};}
    const skipDraft=provider.draftOnlyAccepted&&(u.relevance!=='POLITICAL_NEWS'||u.priority==='P4'||!u.event.action||!u.event.actors.length||!u.event.facts.length||!['NEW_EVENT','MATERIAL_UPDATE'].includes(preparedMatch?.classification??''));
    const preparedDraft=!filter&&!skipDraft?await provider.draft({content:post.originalContent,understanding:u,rules:ruleSet},signal):null;
    signal.throwIfAborted();
    return await client.$transaction(async tx=>{
      // One project, one serial event decision boundary. Read candidates AFTER taking the lock.
      // Prevents concurrent translations creating two events, not just duplicate post IDs.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20916001)`;
      await tx.$queryRaw`SELECT id FROM "ProcessingJob" WHERE id=${job.id} FOR UPDATE`;
      const current=await tx.processingJob.findUniqueOrThrow({where:{id:job.id}});
      if (current.status !== "RUNNING" || current.lockedBy !== job.lockedBy || !current.lockedAt || current.lockedAt.getTime()+leaseMs <= Date.now()) throw new ProcessingError("STALE_CLAIM",true);
      await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${post.sourceId} FOR SHARE`;
      const liveSource=await tx.source.findUniqueOrThrow({where:{id:post.sourceId}});
      if(liveSource.processingMode!==processingMode)throw new ProcessingError('SOURCE_PROCESSING_MODE_CHANGED',true,undefined,1000);
      if (!liveSource.enabled || liveSource.deletedAt) throw new ProcessingError("SOURCE_DISABLED");
      if (provider.live) {
        assertShadowMode();
        assertApprovalMode((await tx.appSettings.findUnique({where:{id:1}}))?.publishingMode);
      }
      const rules=await tx.editorialRuleSet.upsert({where:{version:ruleSet.version},update:{},create:{version:ruleSet.version,rules:json(ruleSet),provenance:json(ruleSet.provenance)}});
      const base={originalLanguage:u.language,relevance:u.relevance,relevanceResult:json({processingMode,scope,topic:u.topic,priority:u.priority,sourceProfile,rationale:u.rationale,ruleSetVersion:ruleSet.version}),processingStartedAt:post.processingStartedAt??new Date(attemptStartedAt),processingEndedAt:null,error:null,nextRetryAt:null};
      if (filter) {
        await tx.sourcePost.update({where:{id:post.id},data:{...base,status:"FILTERED",rejectionReason:u.filterReason,processingResult:json({editorialEligibility:'FILTERED',deliveryDecision:'HOLD',ruleSetVersion:ruleSet.version,filterReason:u.filterReason,review:initialReview(u,sourceProfile,post.originalContent),provider:provider.id})}});
        await audit(tx,post.id,"FILTER_AND_MATCH","استبعاد من مسار النشر",{reason:u.filterReason,rule:"P2.2"});
      } else {
        // Historical candidates are retained; matcher marks probable matches outside 24h for review.
        if(!snapshot||!preparedMatch||(await eventSnapshot(tx)).key!==snapshot.key)throw new ProcessingError('MATCH_SNAPSHOT_CHANGED',true,undefined,1000);
        const match=preparedMatch;
        // Groq's larger model is reserved for accepted new/material stories, never duplicate or unresolved events.
        if (provider.draftOnlyAccepted && (u.relevance !== "POLITICAL_NEWS" || u.priority === "P4" || !u.event.action || !u.event.actors.length || !u.event.facts.length || !["NEW_EVENT","MATERIAL_UPDATE"].includes(match.classification))) {
          const status = match.classification === "DUPLICATE" ? "DUPLICATE" : "NEEDS_REVIEW";
          const review = initialReview(u,sourceProfile,post.originalContent);
          if (match.classification === "UNCERTAIN_MATCH") review.push(reason("UNCERTAIN_MATCH",match.rationale));
          if (!u.event.action || !u.event.actors.length || !u.event.facts.length) review.push(reason("CONTEXT_REQUIRED","استخراج الحدث ناقص"));
          const links = match.classification === "UNCERTAIN_MATCH" ? match.candidates.map(c=>c.revisionId) : match.candidate ? [match.candidate.revisionId] : [];
          for (const revisionId of links) await tx.eventMatch.upsert({where:{sourcePostId_eventRevisionId:{sourcePostId:post.id,eventRevisionId:revisionId}},update:{},create:{sourcePostId:post.id,eventRevisionId:revisionId,classification:match.classification,rationale:match.rationale,evidence:json(match.evidence),matcherVersion:"layered-v1"}});
          if (status === "DUPLICATE" && match.candidate) {
            const existing = await tx.newsItem.findUnique({where:{eventRevisionId:match.candidate.revisionId}});
            if (existing) await tx.newsEvidence.upsert({where:{newsItemId_sourcePostId:{newsItemId:existing.id,sourcePostId:post.id}},update:{},create:{newsItemId:existing.id,sourcePostId:post.id}});
          }
          await tx.sourcePost.update({where:{id:post.id},data:{...base,status,processingResult:json({ruleSetVersion:ruleSet.version,provider:provider.id,classification:match.classification,extraction:u,match,draft:null,draftSkippedReason:"NOT_ACCEPTED_FOR_FINAL_REWRITE",review,externalPublishingEnabled:false})}});
          await audit(tx,post.id,"DRAFT_SKIPPED","حفظ الاستخراج والتطابق؛ لا حاجة لصياغة نهائية الآن",{classification:match.classification,status,provider:provider.id});
          await tx.processingJob.update({where:{id:job.id},data:{status:"COMPLETED",lockedAt:null,lockedBy:null,lastError:null}});
          return {postId:post.id,filtered:false};
        }
        if(!preparedDraft)throw new ProcessingError('DRAFT_PREPARATION_REQUIRED');
        const rawDraft=preparedDraft;
        const draft=provider.constrainedRewrite?finalizeConstrainedDraft(rawDraft,post.originalContent,u,sourceProfile):editDraft(rawDraft,post.originalContent,u,sourceProfile);
        const review=[...draft!.review];
        if (!u.event.action || !u.event.actors.length || !u.event.facts.length) review.push(reason("CONTEXT_REQUIRED","استخراج الحدث ناقص"));
        if (match.classification === "UNCERTAIN_MATCH") review.push(reason("UNCERTAIN_MATCH",match.rationale));
        if (match.candidates.some(c=>Array.isArray((c.evidence.semantic as {conflictingFactIds?:string[]})?.conflictingFactIds) && ((c.evidence.semantic as {conflictingFactIds:string[]}).conflictingFactIds.length>0))) review.push(reason("FIGURE_CONFLICT"));
        let revisionId=match.candidate?.revisionId;
        let newsItemId:string|undefined;
        if (match.classification === "NEW_EVENT" && review.some(r=>r.code === "CONTEXT_REQUIRED" && r.detail === "استخراج الحدث ناقص")) {match.classification="UNCERTAIN_MATCH";revisionId=undefined;}
        if (match.classification === "NEW_EVENT") {
          const event=await tx.canonicalEvent.create({data:{title:draft!.title,summary:u.event.summary??draft!.title,facts:json(u.event),entities:json(u.event.actors),occurredAt:u.event.eventTime?new Date(u.event.eventTime.iso):null,extractionVersion:provider.id,revisions:{create:{revision:1,facts:json(u.event)}}},include:{revisions:true}});
          revisionId=event.revisions[0].id;
        } else if (match.classification === "MATERIAL_UPDATE" && match.candidate) {
          // Revision preserves old known facts; new evidence is a separate immutable revision.
          const merged={...u.event,facts:[...match.candidate.data.facts.filter(f=>!u.event.facts.some(n=>n.key===f.key)),...u.event.facts]};
          const revision=await tx.eventRevision.create({data:{eventId:match.candidate.id,revision:match.candidate.revision+1,facts:json(merged),materialChange:match.newFactIds.map(id=>u.event.facts.find(f=>f.id===id)!.arabic).join("؛ ")}});
          revisionId=revision.id;
        }
        if(sourceMediaReviewRequired(post.metadata,post.originalContent))review.push(reason('EDITORIAL_ATTESTATION_REQUIRED','SOURCE_MEDIA_EVIDENCE_REVIEW_REQUIRED: النص يحيل إلى دليل مرئي يحتاج إلى مراجعة'));
        const reviewState=review.length>0 || match.classification === "UNCERTAIN_MATCH";
        // This worker is a draft-only service. Eligibility never authorizes a send.
        const decision=editorialDecision({validated:true,review,filtered:match.classification==='DUPLICATE'},{autoPublish:false,shadowMode:true,requireApproval:true});
        const status=match.classification === "DUPLICATE" ? "DUPLICATE" : reviewState ? "NEEDS_REVIEW" : "PENDING_APPROVAL";
        if (revisionId && match.classification !== "UNCERTAIN_MATCH") {
          const existing=await tx.newsItem.findUnique({where:{eventRevisionId:revisionId}});
          if (match.classification === "DUPLICATE") newsItemId=existing?.id;
          else {
            const item=await tx.newsItem.create({data:{eventRevisionId:revisionId,title:draft!.title,arabicContent:draft!.body,status,validationStatus:reviewState?"NEEDS_REVIEW":"PASSED",protectedQuotes:json(draft!.protectedQuotes),factualEvidence:json(u.event.facts),validationResult:json({processingMode,...decision,validated:true,format:match.classification==='MATERIAL_UPDATE'?'UPDATE':draft.format,review,applied:draft!.applied,sentenceEvidence:draft!.sentenceEvidence,externalPublishingEnabled:false}),needsReviewReasons:review.map(r=>`${r.code}: ${r.explanation}${r.detail ? " — "+r.detail : ""}`),ruleSetId:rules.id,modeAtProcessing:post.modeAtProcessing,processingStartedAt:base.processingStartedAt,processingEndedAt:null}});
            newsItemId=item.id;
          }
          if (newsItemId) await tx.newsEvidence.upsert({where:{newsItemId_sourcePostId:{newsItemId,sourcePostId:post.id}},create:{newsItemId,sourcePostId:post.id},update:{}});
        }
        const links=match.classification === "UNCERTAIN_MATCH" ? match.candidates.map(c=>c.revisionId) : revisionId ? [revisionId] : [];
        for (const id of links) await tx.eventMatch.upsert({where:{sourcePostId_eventRevisionId:{sourcePostId:post.id,eventRevisionId:id}},update:{},create:{sourcePostId:post.id,eventRevisionId:id,classification:match.classification,rationale:match.rationale+(match.candidate?.published?" — سبق نشر الحدث":""),evidence:json(match.evidence),matcherVersion:"layered-v1"}});
        await tx.sourcePost.update({where:{id:post.id},data:{...base,status,processingResult:json({processingMode,...decision,validated:true,ruleSetVersion:ruleSet.version,provider:provider.id,classification:match.classification,eventRevisionId:revisionId??null,match:{rationale:match.rationale,evidence:match.evidence,candidates:match.candidates},extraction:u,draft,review,externalPublishingEnabled:false})}});
        for (const action of pipelineOrder) await audit(tx,post.id,action,action === "PUBLISHING_DECISION"?"المسودة محفوظة؛ الإرسال الخارجي معطل":`اكتملت مرحلة ${action}`,{processingMode,durationMs:Date.now()-attemptStartedAt,ruleSetVersion:ruleSet.version,classification:match.classification,status,reviewCodes:review.map(r=>r.code)});
      }
      await tx.processingJob.update({where:{id:job.id},data:{status:"COMPLETED",lockedAt:null,lockedBy:null,lastError:null}});
      return { postId:post.id, filtered:filter };
    },{timeout:30000,maxWait:5000});
  } catch (error) {
    const code=error instanceof ProcessingError?error.code:signal.aborted?"WORKER_INTERRUPTED":"PROCESSING_FAILED";
    // Replan outside the lock. Checkpointed stages replay locally; new event
    // comparisons alone may require capacity. Bound churn under active writers.
    if(code==='MATCH_SNAPSHOT_CHANGED'&&snapshotRetry<2&&!signal.aborted)return runJob(client,job,provider,signal,snapshotRetry+1,attemptStartedAt);
    const policy=failurePolicy(code,job.attemptCount,error instanceof ProcessingError?error.retryAfterMs:0);
    const retryable=policy.retryable || !(error instanceof ProcessingError) || error.retryable;
    const budgetHold=isProviderWait(code)||code==='MATCH_SNAPSHOT_CHANGED'||code==='SOURCE_PROCESSING_MODE_CHANGED';
    await client.$transaction(async tx=>{
      const terminal=!retryable || (!budgetHold&&job.attemptCount>=job.maxAttempts);
      const preciseWait=budgetHold&&error instanceof ProcessingError&&error.retryAfterMs>0;
      const next=new Date(Date.now()+(preciseWait?error.retryAfterMs:Math.max(retryDelay(job.attemptCount),policy.delayMs)));
      const changed=await tx.processingJob.updateMany({where:{id:job.id,status:"RUNNING",lockedBy:job.lockedBy},data:{status:terminal?"FAILED":"RETRY",availableAt:next,lockedAt:null,lockedBy:null,lastError:code,...(budgetHold?{attemptCount:{decrement:1}}:{})}});
      if (changed.count) {
        const decision=editorialDecision({error:code},{autoPublish:false,shadowMode:true,requireApproval:true});
        await tx.sourcePost.update({where:{id:post.id},data:{status:terminal?"NEEDS_REVIEW":"FAILED",error:code,retryCount:job.attemptCount,nextRetryAt:terminal?null:next,processingResult:json({processingMode,...decision,recovery:{state:terminal?(retryable?"MANUAL_RECOVERY_REQUIRED":"HUMAN_REVIEW_REQUIRED"):"SCHEDULED_RETRY",attempt:job.attemptCount,maxAttempts:job.maxAttempts},ruleSetVersion:ruleSet.version,...(error instanceof ProcessingError&&error.diagnostic?{diagnostic:error.diagnostic}:{}),review:decision.editorialEligibility==='PROCESSING_ERROR'?[]:[reason("UNSUPPORTED_OUTPUT",code)]})}});
        await audit(tx,post.id,"PROCESSING_ERROR","تعذرت المعالجة؛ تفاصيل آمنة للمراجعة",{code,retryable,attempt:job.attemptCount,recovery:terminal?(retryable?'MANUAL_RECOVERY_REQUIRED':'HUMAN_REVIEW_REQUIRED'):'SCHEDULED_RETRY',priorProcessingResult:post.processingResult});
        if(isProviderWait(code))await audit(tx,post.id,'PROCESSING_PROVIDER_WAIT','Provider-dependent stage scheduled; processing lane released',{jobId:job.id,code,eligibleAt:next.toISOString(),startedAt:new Date().toISOString()});
      }
    });
    return {postId:post.id,error:code};
  }
}
export async function pollSources(client: PrismaClient, monitors: Partial<Record<"TELEGRAM"|"X",Monitor>>, signal: AbortSignal, options: PollSourcesOptions = {}) {
  const report: {sourceId:string;posts:number;error:string|null}[] = [];
  const exhausted=new Map<string,number>();
  const now=options.now??Date.now;
  const record=(sourceId:string,posts:number,error:string|null)=>{
    const row=report.find(r=>r.sourceId===sourceId);
    if(row){row.posts+=posts;row.error=error;}else report.push({sourceId,posts,error});
  };
  // Round-robin durable pages: no total/per-minute message cap, no provider
  // admission dependency. Refresh enabled sources and persisted cursors each
  // round so a hot source cannot monopolize the other enabled channels.
  while(!signal.aborted){
  const sources=(await client.source.findMany({where:{enabled:true,deletedAt:null},orderBy:[{lastPollAt:'asc'},{id:'asc'}]})).filter(s=>(!exhausted.has(s.id)||now()-exhausted.get(s.id)!>=30000)&&monitors[s.platform]);
  if(!sources.length)break;
  for (const source of sources) {
    if (signal.aborted) break;
    const adapter=monitors[source.platform];
    if (!adapter) continue;
    const started=Date.now();
    let phase:PollProgress['phase']='READING',posts=0;
    const progress=(error:string|null=null,cursor?:unknown)=>options.onProgress?.({sourceId:source.id,handle:source.handle,phase,posts,error,cursor,durationMs:Date.now()-started});
    try {
      options.requireActive?.();progress();
      if (adapter.live) {
        assertShadowMode();
        assertApprovalMode((await client.appSettings.findUnique({where:{id:1}}))?.publishingMode);
        if (source.platform !== "TELEGRAM") throw new ProcessingError("LIVE_PLATFORM_DISABLED");
      }
      // The transport owns read timeout/cancellation/reconnect. Never race
      // persistence against a read timeout or abandon an in-flight DB write.
      const batch=await adapter.poll({handle:source.handle,cursor:source.cursor},signal);
      phase='PERSISTING';progress();
      for (const post of batch.posts) {
        signal.throwIfAborted();options.requireActive?.();
        await ingest(client,source.id,post,adapter.live);posts++;
      }
      // Cursor advances only after all posts commit. Replay is safe after interruption.
      signal.throwIfAborted();options.requireActive?.();
      await client.source.update({where:{id:source.id},data:{cursor:batch.cursor == null?Prisma.DbNull:json(batch.cursor),lastPollAt:new Date(),lastError:null}});
      phase='COMPLETE';progress(null,batch.cursor);
      record(source.id,posts,null);
      // A perpetually busy source must not prevent periodic rechecks of a
      // previously empty source. This is idle polling cadence, never a cap on
      // how many messages can be collected from an active source.
      if(!batch.hasMore)exhausted.set(source.id,now());
    } catch (error) {
      if (signal.aborted) throw error;
      const authoredCode=error instanceof ProcessingError ? error.code : null;
      if (authoredCode && ['WORKER_DRAIN_FAILED','WORKER_LEASE_LOST','TELEGRAM_AUTHORIZATION_REQUIRED','TELEGRAM_SESSION_INVALID','TELEGRAM_SESSION_CONFLICT','TELEGRAM_CREDENTIALS_REQUIRED','SHADOW_MODE_REQUIRED','REQUIRE_APPROVAL_REQUIRED','PUBLISHING_MUST_BE_DISABLED'].includes(authoredCode)) throw error;
      // Only application codes and Prisma's documented numeric codes are safe;
      // never persist arbitrary dependency messages, URLs, or RPC payloads.
      const prismaCode=error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code : null;
      const code=authoredCode ?? prismaCode ?? (phase==='PERSISTING'?'SOURCE_PERSIST_FAILED':'MONITOR_UNAVAILABLE');
      options.requireActive?.();
      await client.source.update({where:{id:source.id},data:{lastPollAt:new Date(),lastError:code}});
      phase='ERROR';progress(code);
      record(source.id,posts,code);exhausted.set(source.id,now());
    }
  }
  }
  return report;
}
