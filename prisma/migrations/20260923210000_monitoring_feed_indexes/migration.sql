-- Keyset feed ordering, without loading processing outcomes or counting history.
CREATE INDEX CONCURRENTLY "SourcePost_ingestedAt_id_idx" ON "SourcePost"("ingestedAt", "id");
