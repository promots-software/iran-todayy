-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TELEGRAM', 'X');

-- CreateEnum
CREATE TYPE "PublishingMode" AS ENUM ('REQUIRE_APPROVAL', 'AUTO_PUBLISH');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('INGESTED', 'NORMALIZED', 'CLASSIFYING', 'DEDUPLICATING', 'DRAFTING', 'VALIDATING', 'NEEDS_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'QUEUED', 'PUBLISHED', 'FILTERED', 'REJECTED', 'DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "EventClassification" AS ENUM ('NEW_EVENT', 'DUPLICATE', 'UPDATE', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "Relevance" AS ENUM ('UNASSESSED', 'POLITICAL_NEWS', 'IRRELEVANT', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('NOT_RUN', 'PASSED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "WorkerState" AS ENUM ('STARTING', 'IDLE', 'BUSY', 'STOPPED', 'ERROR');

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "publishingMode" "PublishingMode" NOT NULL DEFAULT 'REQUIRE_APPROVAL',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "cursor" JSONB,
    "lastPollAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcePost" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "originalContent" TEXT NOT NULL,
    "normalizedContent" TEXT,
    "contentHash" TEXT,
    "originalLanguage" TEXT,
    "sourcePublishedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" TIMESTAMP(3),
    "processingEndedAt" TIMESTAMP(3),
    "relevance" "Relevance" NOT NULL DEFAULT 'UNASSESSED',
    "relevanceResult" JSONB,
    "rejectionReason" TEXT,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'INGESTED',
    "modeAtProcessing" "PublishingMode" NOT NULL DEFAULT 'REQUIRE_APPROVAL',
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "entities" JSONB,
    "facts" JSONB NOT NULL,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "embeddingModel" TEXT,
    "extractionVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRevision" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "facts" JSONB NOT NULL,
    "materialChange" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMatch" (
    "id" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "eventRevisionId" TEXT NOT NULL,
    "classification" "EventClassification" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT NOT NULL,
    "evidence" JSONB,
    "matcherVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "eventRevisionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "arabicContent" TEXT,
    "protectedQuotes" JSONB,
    "factualEvidence" JSONB,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'INGESTED',
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'NOT_RUN',
    "validationResult" JSONB,
    "needsReviewReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rejectionReason" TEXT,
    "modeAtProcessing" "PublishingMode" NOT NULL DEFAULT 'REQUIRE_APPROVAL',
    "ruleSetId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processingStartedAt" TIMESTAMP(3),
    "processingEndedAt" TIMESTAMP(3),

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsEvidence" (
    "newsItemId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,

    CONSTRAINT "NewsEvidence_pkey" PRIMARY KEY ("newsItemId","sourcePostId")
);

-- CreateTable
CREATE TABLE "EditorialRuleSet" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "provenance" JSONB,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "newsItemId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'PENDING',
    "contentSnapshot" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "telegramMessageId" TEXT,
    "telegramResult" JSONB,
    "error" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationAttempt" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "PublicationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "entityType" TEXT,
    "entityId" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "state" "WorkerState" NOT NULL DEFAULT 'STARTING',
    "phase" TEXT NOT NULL DEFAULT 'FOUNDATION',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intervalMs" INTEGER NOT NULL DEFAULT 15000,
    "lastError" TEXT,
    "metadata" JSONB,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Source_enabled_deletedAt_idx" ON "Source"("enabled", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Source_platform_handle_key" ON "Source"("platform", "handle");

-- CreateIndex
CREATE INDEX "SourcePost_contentHash_idx" ON "SourcePost"("contentHash");

-- CreateIndex
CREATE INDEX "SourcePost_status_ingestedAt_idx" ON "SourcePost"("status", "ingestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePost_sourceId_sourcePostId_key" ON "SourcePost"("sourceId", "sourcePostId");

-- CreateIndex
CREATE INDEX "CanonicalEvent_occurredAt_idx" ON "CanonicalEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "CanonicalEvent_createdAt_idx" ON "CanonicalEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventRevision_eventId_revision_key" ON "EventRevision"("eventId", "revision");

-- CreateIndex
CREATE INDEX "EventMatch_eventRevisionId_classification_idx" ON "EventMatch"("eventRevisionId", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "EventMatch_sourcePostId_eventRevisionId_key" ON "EventMatch"("sourcePostId", "eventRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_eventRevisionId_key" ON "NewsItem"("eventRevisionId");

-- CreateIndex
CREATE INDEX "NewsItem_status_createdAt_idx" ON "NewsItem"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialRuleSet_version_key" ON "EditorialRuleSet"("version");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_newsItemId_key" ON "Publication"("newsItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_idempotencyKey_key" ON "Publication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Publication_status_nextRetryAt_idx" ON "Publication"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_destination_telegramMessageId_key" ON "Publication"("destination", "telegramMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationAttempt_publicationId_attempt_key" ON "PublicationAttempt"("publicationId", "attempt");

-- CreateIndex
CREATE INDEX "ProcessingJob_status_availableAt_idx" ON "ProcessingJob"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_sourcePostId_stage_key" ON "ProcessingJob"("sourcePostId", "stage");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "SourcePost" ADD CONSTRAINT "SourcePost_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRevision" ADD CONSTRAINT "EventRevision_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CanonicalEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMatch" ADD CONSTRAINT "EventMatch_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "SourcePost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMatch" ADD CONSTRAINT "EventMatch_eventRevisionId_fkey" FOREIGN KEY ("eventRevisionId") REFERENCES "EventRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_eventRevisionId_fkey" FOREIGN KEY ("eventRevisionId") REFERENCES "EventRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "EditorialRuleSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsEvidence" ADD CONSTRAINT "NewsEvidence_newsItemId_fkey" FOREIGN KEY ("newsItemId") REFERENCES "NewsItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsEvidence" ADD CONSTRAINT "NewsEvidence_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "SourcePost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_newsItemId_fkey" FOREIGN KEY ("newsItemId") REFERENCES "NewsItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "SourcePost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants beyond Prisma's declarative schema.
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_singleton" CHECK ("id" = 1);
ALTER TABLE "Source" ADD CONSTRAINT "Source_normalized_handle" CHECK ("handle" = lower("handle"));
ALTER TABLE "EventRevision" ADD CONSTRAINT "EventRevision_positive_revision" CHECK ("revision" > 0);
ALTER TABLE "EventMatch" ADD CONSTRAINT "EventMatch_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "SourcePost" ADD CONSTRAINT "SourcePost_nonnegative_retries" CHECK ("retryCount" >= 0);
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_nonnegative_attempts" CHECK ("attemptCount" >= 0);
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_positive_attempt" CHECK ("attempt" > 0);
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_valid_attempts" CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0);
ALTER TABLE "WorkerHeartbeat" ADD CONSTRAINT "WorkerHeartbeat_positive_interval" CHECK ("intervalMs" > 0);
