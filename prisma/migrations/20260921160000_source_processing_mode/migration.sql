CREATE TYPE "SourceProcessingMode" AS ENUM ('NORMAL', 'DIRECT');
ALTER TABLE "Source" ADD COLUMN "processingMode" "SourceProcessingMode" NOT NULL DEFAULT 'NORMAL';
