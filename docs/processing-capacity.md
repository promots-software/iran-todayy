# Processing capacity and latency

Telegram collection is independent of the two processing lanes. Claiming uses
durable 3-fresh/1-oldest-due fairness and never consults provider capacity.
Local scope checks and successful checkpoints run before any network permit.
Unknown scope remains review, never a fabricated filter result. Minimal
extraction's `IRRELEVANT` label alone is not enough to bypass the validated
classification/filter contract; there is no new model-label-only early exit.

Immediately before each uncached Gemini request, a short database transaction
reserves the specific request's conservative input/output cost and quota.
Limits are 15 requests/minute, 250,000 input tokens/minute and 500 requests per
Pacific calendar day (including DST). These request-level limits supersede the
former 45 requests/hour application gate. The $1 rolling-24-hour ceiling remains
unchanged and can still limit AI-dependent throughput. No tier or
quota increase is implied. Successful usage settles reservations; failed or
ambiguous usage remains conservatively charged to the application budget.

Gemini receives the response schema once through Structured Outputs, rather
than also embedding its identical JSON in the prompt. An exactly duplicated
coverage policy is supplied once. All other instructions and schema fields
remain unchanged. ID-only classification output reservations scale with the
required IDs; extraction, translation and independent review keep their limits.
Exact legacy request bodies remain checkpoint aliases for the same post/input:
completed output still goes through validation, and ambiguous requests stay
blocked. No cross-post factual cache or new inference shortcut is introduced.

A capacity wait saves the job's next eligible time and releases its lane.
Quota exhaustion, cost waits and sanitized provider rejection diagnostics are
visible as `CAPACITY_WAIT`, not healthy idle processing. Retry-After is honored.
An unknown 429/5xx opens only the model request resource; after its wait, one
durable 65-second probe lease prevents a recovery stampede. Ambiguous requests
retain their reconciliation checkpoint and are never blindly replayed.
Legacy exponentially increasing cooldown rows no longer gate claims.

Semantic comparison uses an event snapshot outside the advisory lock. The
short decision transaction rechecks that snapshot before committing; changes
cause bounded replanning using cached stages. No AI calls hold the event lock.
Final rendering remains local, and non-Arabic rendering keeps its independent
review. Editorial and publication safeguards are unchanged.

`PROCESSING_ATTEMPT_FINISHED` records attempt eligibility, actual work start,
finish and active duration. `PROCESSING_PROVIDER_WAIT` records wait start and
next eligibility. `PROCESSING_DECISION_COMMITTED` records the time the commit
was observed (not PostgreSQL's exact internal commit timestamp). Final stored
completion is recorded only after the decision transaction resolves.

Every 30 seconds the worker emits `PROCESSING_SLO`/`PROCESSING_SLO_ALERT`, queue
counts, active lanes, oldest eligible story age, oldest due wait, current
provider-wait age, quota reservations and capacity. Initial targets: ingestion
60s, eligible wait 15s, processing 120s, source-to-review 180s. Missing timing is
null, not zero. Last-hour latency samples are bounded to 1,000 posts and fresh
source timestamps to distinguish old backfill from live ingestion. Alerts are
structured production logs; no paid notification service is provisioned.

No schema migration is required. Publishing remains disabled, approval and
shadow mode remain required. This change does not requeue historical jobs,
reset cursors, or change source configuration.
