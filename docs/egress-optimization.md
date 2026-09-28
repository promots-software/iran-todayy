# Database egress optimization — offline staging gate

2026-09-28. Branch `codex/staging-v44`; task-start HEAD `8262805a9a9ade58cc79af7f7ef5f0e33163d688`.

## Changes and correctness

- Provider accounting now returns one PostgreSQL summary, not audit history. Reservations remain immutable audit records. Settlement maxima, original reservation age, rolling 24-hour boundaries, Pacific quota day, per-resource capacity/probe state and exact request-specific expiry are evaluated from the same history. SQL uses decimal sums, returned as JavaScript numbers; oracle comparisons allow only floating-point summation noise (1e-10), not approximate/sampled accounting.
- The existing reservation advisory lock, database clock, operation retry count, checkpoint claims and reservation transaction remain authoritative. No materialized counter can become stale. No schema migration is required.
- Early reconsideration of a cost-wait job now requires persisted `updatedAt` older than five minutes. Existing `availableAt` expiry is unchanged; claims retain row locking and normal request-level budget authorization. A restart does not reset the bound. Transient provider retries are unchanged.
- Canonical event snapshots read fresh database fingerprints on EVERY read, including the transaction fence. Only unchanged payloads are reused from a bounded 512-entry content-addressed cache. Revision/facts/publication/timestamp changes invalidate through their content digest. Cache absence affects transfer, not correctness. The legacy non-canonical engine snapshot is outside this change.
- Publisher policy-owned history first checks only blocking statuses, then fetches pending publications. News candidate pages fetch IDs and source IDs; full evidence is fetched after source locks for the existing fresh eligibility checks. Policy cutovers, human approval and exactly-once delivery are unchanged.

## Reproducible offline benchmark

`tests/egress-benchmark.test.ts` uses disposable localhost PostgreSQL with 6,845 synthetic audit rows in runtime metadata shape, the tracked historical retrieval catalog, and 100 synthetic SENT publications with valid origin relations. No remote database or provider is contacted.

Bytes are UTF-8 serialized query RESULT bytes, not PostgreSQL protocol/TLS billing measurements.

| Read | Before | After |
|---|---:|---:|
| Budget history | 1 query, 6,845 rows, 1,386,336 bytes | 1 query, 1 row, 230 bytes |
| Canonical snapshot | 71 top-level rows, 190,434 bytes | cold 71 rows / 198,090 bytes; warm 71 rows / 6,604 bytes |
| Owned publication history, OPEN and all sent | 1 query, 100 rows, 9,201 bytes | 2 queries, zero rows, 6 bytes (`null` + `[]`) |

Cold snapshot payload is slightly larger because fingerprints are included. Changed events transfer their full payload; an unchanged warm snapshot reduces returned bytes by 96.5%. The database still computes the fresh snapshot: this is an egress optimization, not a claim of constant server CPU. Cache overflow increases transfer safely.

The budget-only projection assumes one monitoring cycle per 30 seconds (2,880/day), the previously observed AI share 628/746, and 205 calls/61 AI stories. It excludes unmeasured protocol overhead, extra operator polling and retry mix. It includes normal idle monitoring.

| Incoming/day | Budget queries/day | Old result GB/day | New result MB/day | Total application DB egress/day |
|---:|---:|---:|---:|---|
| 480 | 4,237.96 | 5.8752 | 0.9747 | UNVERIFIED |
| 500 | 4,294.54 | 5.9537 | 0.9877 | UNVERIFIED |
| 600 | 4,577.45 | 6.3459 | 1.0528 | UNVERIFIED |

Idle budget monitoring alone: 3.9926 GB/day before, 0.6624 MB/day after. A conservative 2 KB summary sensitivity at 500 incoming is 8.59 MB/day. Thus the measured accounting-result component is far below the 100 MB/day target; total Supabase billed transfer cannot be guaranteed by this offline fixture.

### Blocked jobs

Each actual blocked admission still performs one accounting query, now one small row instead of history. The reservation transaction keeps its four statements before a cost rejection: advisory lock, database clock, operation count, accounting query (plus transaction control). Checkpoint/claim/audit statements are unchanged and not included in that four-statement count. Exact whole-job wire bytes are UNVERIFIED.

Previously an otherwise-eligible early cost recheck could recur with each fresh monitoring observation. Now each job's persisted timestamp enforces five minutes for that early path, even across workers/restarts; its actual scheduled expiry can still run sooner. Under a continuously eligible 30-second monitoring scenario, the early-path ceiling changes from 2,880 to 288 attempts/job/day. These are bounds, not measured natural retry counts. Per-attempt accounting-result transfer in this fixture changes from 1,386,336 to 230 bytes.

## Verification

- Required retrieval replay: 255/255, unchanged `CANONICAL_RETRIEVAL_V1`.
- Strict gold: relationships 38/38; decisions 35/35; duplicates 13/13; updates 7/7; uncertainty 18/18.
- Actual application matcher with injected in-memory provider: 141/141 valid decisions; 114/114 invalid/truncated receipts rejected. No network calls.
- Relevant processing/matching suite: 22 files, 998 tests, 995 pass, 3 fail, 0 skipped.
- Targeted accounting/snapshot/benchmark/cost/retry/publisher suite: 75/75 pass, 0 skipped.
- Additional realtime queue suite: 11/12 pass. Its outside-Iran fixture expects FILTERED but committed HEAD produces FAILED; independently reproduced on isolated HEAD.
- All three relevant-suite failures also reproduced on isolated task-start HEAD: two old canonical-fidelity instruction assertions and `gemini-provider` safe diagnostic assertion. Tests and unrelated behavior were not changed to hide them.
- Typecheck, scoped lint and whitespace check: pass.
- New tests cover settlement replacement, expiry, malformed records failing closed, UTC timestamps, restart, quota recovery, concurrent recovery probes, concurrent reservations, checkpoint reuse, fresh snapshot invalidation and publisher protections.

No new semantic regression was observed. This is not a fully green repository baseline and does not prove live performance or universal semantic reliability.

## Preserved and next gate

Canonical 40/40 SHA256 unchanged:
`9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456`.

Generation, checker, R1/R2, retrieval decisions, prices, limits, publishing policy and configuration are unchanged. Separate local experimental work is excluded from the commit.

Separate Supabase staging provisioning and a bounded staging test are technically suitable next steps, subject to explicit authorization and isolated destination/configuration checks. Neither was performed. Live SQL latency and billed egress must be measured there before production rollout.

Remote DB mutations 0; Gemini requests 0; Telegram messages 0; deployments 0; pushes 0; production/main unchanged; staging not resumed. Disposable localhost test databases were created and written only for offline tests.
