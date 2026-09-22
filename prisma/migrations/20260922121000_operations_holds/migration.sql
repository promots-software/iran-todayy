-- Independent opt-in operational holds. No existing safety flag changes.
ALTER TABLE "AppSettings" ADD COLUMN "publishingPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN "processingPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Source" ADD COLUMN "processingPaused" BOOLEAN NOT NULL DEFAULT false;
