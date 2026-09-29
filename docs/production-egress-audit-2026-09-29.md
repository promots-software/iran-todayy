# Production egress audit — 29 September 2026

## Proven current facts

- Production contains the prior `0d6a2f0` provider-budget, snapshot-cache and publisher-query fix; deployed file hashes match.
- Old budget-history query has 159,422,002 cumulative returned rows since 22 September. Its counters did not move in the observed current windows. These historical totals are not a current rate.
- A grouped query-counter sample at 16:53:09–16:53:44 UTC observed four single-row budget aggregates and two 461-row fingerprint snapshots. No old budget-history reads.
- At 17:02:12 UTC, a read-only cold/warm snapshot comparison returned 1,195,802 / 43,060 UTF-8 JSON bytes for 463 events, with identical semantic snapshot keys. This diagnostic process has a separate cache; these are cold/warm bounds, not a measurement of worker cache misses.
- Staging has no active Railway deployment, processing/publishing paused, and no new collection/heartbeat since 28 September approximately 09:42 UTC. No Vercel cron is defined. Dashboard visitors and account-side services remain unquantified.

## Proven dashboard over-read and fix

Operations loaded complete processingResult and relevanceResult blobs for today's posts, although it only used processing mode and classification plus status/source ID. At 17:02:12 UTC, 605 records represented 3,215,468 JSON bytes before and 88,965 projected bytes after: a 97.23% reduction. PostgreSQL/TLS framing is excluded.

The new projection preserves JSON types, nullish fallback, all records and date boundaries. No cache, polling, role, accounting, publishing, or editorial behavior changes. Database timestamp-without-time-zone parameters use UTC ISO values explicitly to match Prisma's original date comparison regardless of session timezone.

Operations refresh is opt-in, every 60 seconds while visible and without an open control. At this fixed snapshot size, one continuously refreshing tab would read 192.93 MB/hour before versus 5.34 MB/hour after from this query. Actual current tab frequency is unverified; the initial natural sample contained zero Operations requests. Do not present this scenario as observed organization usage.

## Limits

The supplied 41.2 GB value is an owner-reported organization billing total, not a fresh API measurement. Exact timestamps, project split, billing window and reporting lag for 39.77→41.2 are unavailable. PostgreSQL statement statistics count calls/rows, not billed wire bytes. No defensible whole-system MB/hour or monthly plan-fit claim follows from these samples alone. Reducing future transfers cannot erase accumulated billing-cycle usage. Account restriction timing must be confirmed against current Supabase Usage/billing data.

No DB schema/data changes, test provider calls, Telegram test messages, settings changes, or Staging resume are required for this dashboard-only fix.
