# Newsroom queue and preview release

## Measured basis (2026-09-20 16:44:16 UTC)
14 strictly post-reset arrivals in 1.270964 hours: 11.0153 stories/hour.
Local detection: 9 Arabic, 5 Persian. Existing minimum provider stages:
Arabic extraction + classification (2); Persian additionally translation +
independent rendering validation (4). Atom selection/rendering is already local.
Weighted base: 2.7143 calls/story, 29.8986 calls/hour. Add 50% headroom for
bursts/comparisons: ceil(44.8478) = 45/hour; 45 * 24 = 1080/day.
These are processing guards, never ingestion limits or arrival assumptions.

The $1/day hard cost ceiling stays unchanged. Known HTTP response usage settles
its reservation using the configured Gemini rates ($0.25/$1.50 per million
input/output tokens); failed, incomplete-usage or ambiguous requests keep the
full conservative reservation. Counts still include every network attempt.
No historical reservations are rewritten or refunded. All accounting is durable.
Observed completed paths: Arabic $0.00238225, Persian $0.00520925 excluding the
now-local draft call. Weighted baseline projection at this short sample's rate:
$0.89670/day, excluding additional comparisons/failures; with 50% headroom,
$1.34505/day would exceed the authorized ceiling. The ceiling wins: defer excess
work, never raise spending or stop ingestion. This is a projection, not a promise.

## Scheduling and retries
Two processing lanes overlap independent extraction/classification. Final event
matching and creation retain their existing global transaction lock, preventing
concurrent versions of one event. Telegram polling remains a separate loop and
processing no longer depends on Telegram being connected for already stored jobs.
No one-job/minute delay. Atomic SKIP LOCKED claims have opaque ownership tokens.
Every four committed claims allocate three newest-due slots and one oldest-due
slot. A short scheduler lock and transactional audit cursor preserve fairness
through restarts. Eligible older jobs progress even under continuous fresh
arrivals. Not-yet-due retries are not selected. Existing lease recovery remains.
Budget/cooldown deferrals do not exhaust job attempts; actual provider failures
retain bounded retry counts. HTTP Retry-After and circuit breaker remain.
Successful provider stages and native responses retain unchanged cache keys;
only the free local-draft layout key changes. Unknown charged outcomes remain
held for reconciliation. Exact full validated semantic duplicates skip a model
comparison; temporal/conflict/multiple-event checks are unchanged. All different
or uncertain content still goes through semantic comparison.

## Newsroom UI
READY opens preview + approval with optional edit. NEEDS_REVIEW opens the editor
with Arabic reasons. Human drafts are listed only in their own review/approval
queue, preventing stale AI-ready cards from bypassing a human revision. Raw
technical data is server-rendered only for ADMIN under a collapsed section.
FLASH remains title-only; distinct body is preserved. Long attributed content
uses its grounded attribution as title and retains its entire fact in the body.
Other multi-fact titles select the shortest complete grounded atom, not an AI
summary. No shortening of facts, inferred headlines or relaxed validators.
System status exposes pending/running/retry counts, oldest pending age, recent
throughput, queue/processing median and P95, cooldown and next admission/retry.
Latency uses actual attempt audit timestamps; no samples means not measured.

No automatic publishing, source credential changes, schema migration or
historical requeue. The specified candidate's human edit cancels its unsent
frozen publication with audit and preserves the old snapshot; no reapproval.
