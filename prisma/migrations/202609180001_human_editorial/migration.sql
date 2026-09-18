ALTER TYPE "PublicationStatus" ADD VALUE 'CANCELLED';
CREATE TYPE "HumanEditorialStatus" AS ENUM ('DRAFT', 'APPROVED', 'PUBLISHED');
CREATE TABLE "HumanEditorialDraft" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "sourcePostId" TEXT UNIQUE REFERENCES "SourcePost"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "newsItemId" TEXT UNIQUE REFERENCES "NewsItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "title" TEXT NOT NULL, "body" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "status" "HumanEditorialStatus" NOT NULL DEFAULT 'DRAFT',
 "originalSnapshot" JSONB NOT NULL, "editedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "approvalNote" TEXT,
 CONSTRAINT "HumanEditorialDraft_one_origin" CHECK (("sourcePostId" IS NULL) <> ("newsItemId" IS NULL))
);
ALTER TABLE "Publication" ALTER COLUMN "newsItemId" DROP NOT NULL;
ALTER TABLE "Publication" ADD COLUMN "humanDraftId" TEXT REFERENCES "HumanEditorialDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_one_origin" CHECK (("newsItemId" IS NULL) <> ("humanDraftId" IS NULL));
CREATE INDEX "Publication_humanDraftId_idx" ON "Publication"("humanDraftId");
