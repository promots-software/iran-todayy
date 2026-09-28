-- Must run outside an explicit transaction. PostgreSQL concurrent construction
-- keeps ordinary AuditLog reads and writes available during both index scans.
-- Match Prisma's JSONB #> predicates exactly; do not shorten lifetime accounting.
CREATE INDEX CONCURRENTLY "AuditLog_provider_reservation_attempt_idx"
ON "AuditLog" ((metadata #> ARRAY['postId']::text[]), (metadata #> ARRAY['key']::text[]))
WHERE action = 'PROVIDER_RESERVED'
  AND "entityType" = 'ProviderBudget'
  AND "entityId" = 'gemini';
