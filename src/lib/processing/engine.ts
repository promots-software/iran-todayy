import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { incomingSchema, sourceProfileSchema, unknownProfile, eventSchema, validateUnderstanding, ProcessingError, type LanguageProvider, type Monitor } from "./contracts";
import { editDraft, initialReview, reason } from "./editorial";
import { matchEvent, type Candidate } from "./matcher";
import { pipelineOrder, ruleSet } from "./rules";
import { retryDelay } from "../domain";
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const stage = "PROCESS_V1";
const leaseMs = 300000;
const audit = (tx: Prisma.TransactionClient, id: string, action: string, message: string, metadata: unknown) => tx.auditLog.create({ data: { action, actor: "processing-engine", entityType: "SourcePost", entityId: id, message, metadata: json(metadata) } });
export async function ingest(client: PrismaClient, sourceId: string, raw: unknown) {
  const p=incomingSchema.parse(raw);
  return client.$transaction(async tx=>{
    const source=await tx.source.findUniqueOrThrow({where:{id:sourceId}});
    if (!source.enabled || source.deletedAt) throw new ProcessingError("SOURCE_DISABLED");
    const mode=(await tx.appSettings.findUnique({where:{id:1}}))?.publishingMode ?? "REQUIRE_APPROVAL";
    // Empty upsert update preserves the first received original, even if platform content edits.
    const post=await tx.sourcePost.upsert({where:{sourceId_sourcePostId:{sourceId,sourcePostId:p.externalId}},update:{},create:{sourceId,sourcePostId:p.externalId,sourceUrl:p.url,originalContent:p.content,sourcePublishedAt:p.publishedAt,metadata:json(p.metadata),contentHash:createHash("sha256").update(p.content).digest("hex"),modeAtProcessing:mode}});
    await tx.processingJob.upsert({where:{sourcePostId_stage:{sourcePostId:post.id,stage}},update:{},create:{sourcePostId:post.id,stage}});
    return post;
  });
}
export async function claimJob(client: PrismaClient, workerId: string, now=new Date()) {
  // A fresh opaque claim token fences stale processes after restart or lease recovery.
  const token=`${workerId}:${randomUUID()}`;
  return client.$transaction(async tx=>{
    const expired=await tx.processingJob.findMany({where:{stage,status:"RUNNING",lockedAt:{lt:new Date(now.getTime()-leaseMs)}}});
    for(const job of expired) {
      const exhausted=job.attemptCount>=job.maxAttempts;
      const reclaimed=await tx.processingJob.updateMany({where:{id:job.id,status:"RUNNING",lockedBy:job.lockedBy,lockedAt:job.lockedAt},data:{status:exhausted?"FAILED":"RETRY",lockedAt:null,lockedBy:null,availableAt:now,lastError:exhausted?"LEASE_EXHAUSTED":"LEASE_EXPIRED"}});
      if(reclaimed.count && exhausted)await tx.sourcePost.update({where:{id:job.sourcePostId},data:{status:"NEEDS_REVIEW",error:"LEASE_EXHAUSTED",nextRetryAt:null}});
    }
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "ProcessingJob" WHERE "stage" = ${stage} AND "status" IN ('PENDING','RETRY') AND "availableAt" <= ${now} AND "attemptCount" < "maxAttempts" ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    return tx.processingJob.update({where:{id:rows[0].id},data:{status:"RUNNING",lockedAt:now,lockedBy:token,attemptCount:{increment:1}},include:{sourcePost:{include:{source:true}}}});
  });
}
type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimJob>>>;
export async function processJob(client: PrismaClient, job: ClaimedJob, provider: LanguageProvider, signal: AbortSignal) {
  const post=job.sourcePost;
  const profile=sourceProfileSchema.safeParse(post.source.editorialProfile);
  const sourceProfile=profile.success ? profile.data : unknownProfile;
  try {
    signal.throwIfAborted();
    const u=validateUnderstanding(await provider.understand({content:post.originalContent,publishedAt:post.sourcePublishedAt,profile:sourceProfile,rules:ruleSet},signal),post.originalContent);
    // Assign provenance ourselves; never trust a provider-supplied database identity.
    for(const value of [...u.event.actors,u.event.action,u.event.object,u.event.location,u.event.eventTime,...u.event.facts,...u.event.facts.map(f=>f.speaker),...u.names]) if(value)value.evidence.sourcePostId=post.id;
    // Verify numeric evidence at extraction, before terminology (R IX.4).
    const filter=u.relevance === "IRRELEVANT" || ["UNRELATED","ADVERTISING","SPORT","ENTERTAINMENT","SATIRE","RUMOUR","INCITEMENT"].includes(u.filterReason) || (u.filterReason === "OPINION" && !sourceProfile.approvedAnalyst);
    signal.throwIfAborted();
    return await client.$transaction(async tx=>{
      // One project, one serial event decision boundary. Read candidates AFTER taking the lock.
      // Prevents concurrent translations creating two events, not just duplicate post IDs.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20916001)`;
      const current=await tx.processingJob.findUniqueOrThrow({where:{id:job.id}});
      if (current.status !== "RUNNING" || current.lockedBy !== job.lockedBy || !current.lockedAt || current.lockedAt.getTime()+leaseMs <= Date.now()) throw new ProcessingError("STALE_CLAIM",true);
      const liveSource=await tx.source.findUniqueOrThrow({where:{id:post.sourceId}});
      if (!liveSource.enabled || liveSource.deletedAt) throw new ProcessingError("SOURCE_DISABLED");
      const now=new Date();
      const rules=await tx.editorialRuleSet.upsert({where:{version:ruleSet.version},update:{},create:{version:ruleSet.version,rules:json(ruleSet),provenance:json(ruleSet.provenance)}});
      const base={originalLanguage:u.language,relevance:u.relevance,relevanceResult:json({topic:u.topic,priority:u.priority,sourceProfile,rationale:u.rationale,ruleSetVersion:ruleSet.version}),processingStartedAt:post.processingStartedAt??current.lockedAt,processingEndedAt:now,error:null,nextRetryAt:null};
      if (filter) {
        await tx.sourcePost.update({where:{id:post.id},data:{...base,status:"FILTERED",rejectionReason:u.filterReason,processingResult:json({ruleSetVersion:ruleSet.version,filterReason:u.filterReason,review:initialReview(u,sourceProfile),provider:provider.id})}});
        await audit(tx,post.id,"FILTER_AND_MATCH","استبعاد من مسار النشر",{reason:u.filterReason,rule:"P2.2"});
      } else {
        // Historical candidates are retained; matcher marks probable matches outside 24h for review.
        const events=await tx.canonicalEvent.findMany({include:{revisions:{orderBy:{revision:"desc"},take:1,include:{newsItem:{include:{publication:true}},matches:{include:{sourcePost:true}}}}}});
        const candidates:Candidate[]=[];
        let legacy=0;
        for (const e of events) {
          const revision=e.revisions[0], parsed=eventSchema.safeParse(revision?.facts);
          if (!revision || !parsed.success) { legacy++; continue; }
          candidates.push({id:e.id,revisionId:revision.id,revision:revision.revision,data:parsed.data,publishedAt:revision.matches[0]?.sourcePost.sourcePublishedAt??e.createdAt,published:revision.newsItem?.publication?.status === "SENT"});
        }
        const match=await matchEvent(u.event,post.sourcePublishedAt,candidates,provider,signal);
        if (legacy && match.classification === "NEW_EVENT") { match.classification="UNCERTAIN_MATCH";match.rationale="توجد أحداث قديمة بلا استخراج منظم؛ يلزم فحصها قبل إنشاء حدث جديد";match.evidence={legacyEvents:legacy}; }
        const draft=editDraft(await provider.draft({content:post.originalContent,understanding:u,rules:ruleSet},signal),post.originalContent,u,sourceProfile);
        const review=[...draft!.review];
        if (!u.event.action || !u.event.actors.length || !u.event.facts.length) review.push(reason("CONTEXT_REQUIRED","استخراج الحدث ناقص"));
        if (match.classification === "UNCERTAIN_MATCH") review.push(reason("UNCERTAIN_MATCH",match.rationale));
        if (match.candidates.some(c=>Array.isArray((c.evidence.semantic as {conflictingFactIds?:string[]})?.conflictingFactIds) && ((c.evidence.semantic as {conflictingFactIds:string[]}).conflictingFactIds.length>0))) review.push(reason("FIGURE_CONFLICT"));
        let revisionId=match.candidate?.revisionId;
        let newsItemId:string|undefined;
        if (match.classification === "NEW_EVENT" && review.some(r=>r.code === "CONTEXT_REQUIRED" && r.detail === "استخراج الحدث ناقص")) {match.classification="UNCERTAIN_MATCH";revisionId=undefined;}
        if (match.classification === "NEW_EVENT") {
          const event=await tx.canonicalEvent.create({data:{title:draft!.title,summary:u.event.summary,facts:json(u.event),entities:json(u.event.actors),occurredAt:u.event.eventTime?new Date(u.event.eventTime.iso):null,extractionVersion:provider.id,revisions:{create:{revision:1,facts:json(u.event)}}},include:{revisions:true}});
          revisionId=event.revisions[0].id;
        } else if (match.classification === "MATERIAL_UPDATE" && match.candidate) {
          // Revision preserves old known facts; new evidence is a separate immutable revision.
          const merged={...u.event,facts:[...match.candidate.data.facts.filter(f=>!u.event.facts.some(n=>n.key===f.key)),...u.event.facts]};
          const revision=await tx.eventRevision.create({data:{eventId:match.candidate.id,revision:match.candidate.revision+1,facts:json(merged),materialChange:match.newFactIds.map(id=>u.event.facts.find(f=>f.id===id)!.arabic).join("؛ ")}});
          revisionId=revision.id;
        }
        const reviewState=review.length>0 || match.classification === "UNCERTAIN_MATCH";
        const status=match.classification === "DUPLICATE" ? "DUPLICATE" : reviewState ? "NEEDS_REVIEW" : "PENDING_APPROVAL";
        if (revisionId && match.classification !== "UNCERTAIN_MATCH") {
          const existing=await tx.newsItem.findUnique({where:{eventRevisionId:revisionId}});
          if (match.classification === "DUPLICATE") newsItemId=existing?.id;
          else {
            const item=await tx.newsItem.create({data:{eventRevisionId:revisionId,title:draft!.title,arabicContent:draft!.body+"\n\n"+draft!.hashtags.join(" "),status,validationStatus:reviewState?"NEEDS_REVIEW":"PASSED",protectedQuotes:json(draft!.protectedQuotes),factualEvidence:json(u.event.facts),validationResult:json({review,applied:draft!.applied,sentenceEvidence:draft!.sentenceEvidence,externalPublishingEnabled:false}),needsReviewReasons:review.map(r=>`${r.code}: ${r.explanation}${r.detail ? " — "+r.detail : ""}`),ruleSetId:rules.id,modeAtProcessing:post.modeAtProcessing,processingStartedAt:base.processingStartedAt,processingEndedAt:now}});
            newsItemId=item.id;
          }
          if (newsItemId) await tx.newsEvidence.upsert({where:{newsItemId_sourcePostId:{newsItemId,sourcePostId:post.id}},create:{newsItemId,sourcePostId:post.id},update:{}});
        }
        const links=match.classification === "UNCERTAIN_MATCH" ? match.candidates.map(c=>c.revisionId) : revisionId ? [revisionId] : [];
        for (const id of links) await tx.eventMatch.upsert({where:{sourcePostId_eventRevisionId:{sourcePostId:post.id,eventRevisionId:id}},update:{},create:{sourcePostId:post.id,eventRevisionId:id,classification:match.classification,rationale:match.rationale+(match.candidate?.published?" — سبق نشر الحدث":""),evidence:json(match.evidence),matcherVersion:"layered-v1"}});
        await tx.sourcePost.update({where:{id:post.id},data:{...base,status,processingResult:json({ruleSetVersion:ruleSet.version,provider:provider.id,classification:match.classification,eventRevisionId:revisionId??null,match:{rationale:match.rationale,evidence:match.evidence,candidates:match.candidates},extraction:u,draft,review,externalPublishingEnabled:false})}});
        for (const action of pipelineOrder) await audit(tx,post.id,action,action === "PUBLISHING_DECISION"?"المسودة محفوظة؛ الإرسال الخارجي معطل":`اكتملت مرحلة ${action}`,{ruleSetVersion:ruleSet.version,classification:match.classification,status,reviewCodes:review.map(r=>r.code)});
      }
      await tx.processingJob.update({where:{id:job.id},data:{status:"COMPLETED",lockedAt:null,lockedBy:null,lastError:null}});
      return { postId:post.id, filtered:filter };
    },{timeout:45000,maxWait:10000});
  } catch (error) {
    const code=error instanceof ProcessingError?error.code:signal.aborted?"WORKER_INTERRUPTED":"PROCESSING_FAILED";
    const retryable=!(error instanceof ProcessingError) || error.retryable;
    await client.$transaction(async tx=>{
      const terminal=!retryable || job.attemptCount>=job.maxAttempts;
      const next=new Date(Date.now()+retryDelay(job.attemptCount));
      const changed=await tx.processingJob.updateMany({where:{id:job.id,status:"RUNNING",lockedBy:job.lockedBy},data:{status:terminal?"FAILED":"RETRY",availableAt:next,lockedAt:null,lockedBy:null,lastError:code}});
      if (changed.count) {
        await tx.sourcePost.update({where:{id:post.id},data:{status:terminal?"NEEDS_REVIEW":"FAILED",error:code,retryCount:job.attemptCount,nextRetryAt:terminal?null:next,processingResult:json({ruleSetVersion:ruleSet.version,review:[reason(code === "PROVIDER_UNAVAILABLE"?"PROVIDER_UNAVAILABLE":"UNSUPPORTED_OUTPUT",code)]})}});
        await audit(tx,post.id,"PROCESSING_ERROR","تعذرت المعالجة؛ تفاصيل آمنة للمراجعة",{code,retryable,attempt:job.attemptCount});
      }
    });
    return {postId:post.id,error:code};
  }
}
export async function pollSources(client: PrismaClient, monitors: Partial<Record<"TELEGRAM"|"X",Monitor>>, signal: AbortSignal) {
  const sources=await client.source.findMany({where:{enabled:true,deletedAt:null}});
  for (const source of sources) {
    if (signal.aborted) break;
    const adapter=monitors[source.platform];
    if (!adapter) continue;
    try {
      const batch=await adapter.poll({handle:source.handle,cursor:source.cursor},signal);
      for (const post of batch.posts) await ingest(client,source.id,post);
      // Cursor advances only after all posts commit. Replay is safe after interruption.
      await client.source.update({where:{id:source.id},data:{cursor:batch.cursor == null?Prisma.DbNull:json(batch.cursor),lastPollAt:new Date(),lastError:null}});
    } catch {
      await client.source.update({where:{id:source.id},data:{lastPollAt:new Date(),lastError:"MONITOR_UNAVAILABLE"}});
    }
  }
}
