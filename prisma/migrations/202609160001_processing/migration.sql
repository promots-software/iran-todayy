-- Additive only: keep legacy enum values, tables and all existing records.
ALTER TYPE "EventClassification" ADD VALUE 'MATERIAL_UPDATE';
ALTER TYPE "EventClassification" ADD VALUE 'UNCERTAIN_MATCH';
ALTER TABLE "Source" ADD COLUMN "editorialProfile" JSONB;
ALTER TABLE "SourcePost" ADD COLUMN "metadata" JSONB,
  ADD COLUMN "processingResult" JSONB;

-- Processing may enrich a post, but must never rewrite the received evidence.
CREATE FUNCTION preserve_source_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."originalContent" IS DISTINCT FROM OLD."originalContent"
    OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
    OR NEW."sourcePostId" IS DISTINCT FROM OLD."sourcePostId"
    OR NEW."sourceUrl" IS DISTINCT FROM OLD."sourceUrl"
    OR NEW."sourcePublishedAt" IS DISTINCT FROM OLD."sourcePublishedAt"
    OR NEW."metadata" IS DISTINCT FROM OLD."metadata" THEN
    RAISE EXCEPTION 'SOURCE_EVIDENCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_evidence_immutable BEFORE UPDATE ON "SourcePost"
  FOR EACH ROW EXECUTE FUNCTION preserve_source_evidence();
