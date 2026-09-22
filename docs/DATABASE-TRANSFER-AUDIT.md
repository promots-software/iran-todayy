# Database transfer audit — 2026-09-22

## Evidence and limits

Neon management API reports Free `free_v3`, 5,750,454,105 transfer bytes, 60,784,640 synthetic storage bytes, 118,839 compute seconds (33.01 CU-hours), and consumption period 2026-09-15 to 2026-10-01. SQL connections are quota-blocked. Table/column byte distributions and per-query transferred bytes are therefore **not measured**. Aggregate transfer is not a query attribution trace. Local production audits, dashboard reads and worker reads all contribute to the same meter.

Railway status records one deployed replica in its manifest. `production-roles.ts` starts one collection/processing child and one publisher child. Processing has two lanes; collection has a database lease. No duplicate deployment/worker evidence was found. The unused `worker/index.ts` is not the production start command.

## Recurring load (code-derived, not measured query counters)

Counts below exclude transaction BEGIN/COMMIT, connection traffic, latency and additional Prisma relation queries. Daily ceilings assume a continuously healthy database and zero execution time. Real intervals are work duration plus sleep. Four enabled Telegram sources are assumed, based on the last readable production configuration.

| Loop / file | Before → after | Statements per idle cycle | Daily before → after | Payload / assessment |
|---|---|---:|---:|---|
| Two processing lanes, `src/worker/production.ts`, `src/lib/processing/engine.ts::claimJob` | 1s → 3s, only when no claim | 6 per lane (safety, settings, scheduler lock, last slot, expired claims, due claim) | 1,036,800 → 345,600 | Mostly small rows; excessive idle churn. Successful work still immediately claims again. |
| Publisher OFF, `src/worker/telegram-publisher.ts`, `automatic-delivery.ts` | 5s → 15s | 4 (recovery IDs, policy, heartbeat policy, heartbeat upsert) | 69,120 → 23,040 | No candidate enumeration while OFF. Recovery remains active. |
| Publisher ON with no eligible work, same files | 5s → 15s | at least 9; grows with candidates/relations | 155,520 → 51,840 minimum | Previously all owned frozen publication bodies/results fetched every cycle. Now IDs/status/news ID only. Candidate evidence still fully checked. |
| Processor heartbeat/lease, `production.ts`, `runtime.ts` | 15s unchanged | 3 | 17,280 | Safety read, processing hold, fenced lease renewal; necessary. Reads narrowed. |
| Ingestion, `production.ts`, `engine.ts::pollSources` | 30s unchanged; continuous pages during bursts | approximately 3 + 2 per source, excluding new posts | about 31,680 unchanged | Sources/cursors plus per-source safety/read and durable cursor update. Never throttled by AI. |
| Observer, `production.ts`, `latency.ts`, `provider-guard.ts` | 30s unchanged | 10 logical calls | 28,800 unchanged | Reloads provider accounting window and rolling-hour latency data. High recurring bytes despite modest query count. Kept unchanged to preserve fresh cost-wait and SLO behavior. |
| Publisher DB failure | fixed 5s plus error duration → 10/20/40/60s | first failed DB operation; previously followed by heartbeat DB attempt | bounded near 1,440 failed cycles/day once backed off, excluding latency | Avoids immediate redundant heartbeat reads after dependency failure. No transport retries added. |
| Processor DB failure | existing exponential backoff to 300s with jitter | depends on failing stage | variable | Existing outer reconnect/lease backoff retained. Processing lane errors already bounded; heartbeat failure aborts/drains the cycle. |
| Settings acknowledgement, `auto-publish-acknowledgement.tsx` | 5s, maximum six refreshes, only while awaiting | 3 page reads plus auth reads | at most 18 page reads per acknowledgement, plus auth | Bounded; not continuously polling. |
| Operations, `operations-refresh.tsx`, `operations.ts`, `queue-health.ts` | opt-in 60s, visible tab only, stops with open control | roughly 25–30 logical reads | roughly 36k–43k per continuously open opted-in tab/day | Today’s full processing JSON and audit metadata can be large. Default OFF. |
| Other dashboard/API routes | request-driven | route-dependent | not measured | Broad news detail/feed includes load original content, extraction, provenance and audit results. No other periodic client timer found. Health API does not poll SQL. No production cron found. |
| Legacy `worker/index.ts` | 15s default, configurable 1–60s | heartbeat, source listing, claim | excluded | Not launched by current production role supervisor. |

Approximate healthy idle baseline: **1.18m statements/day OFF**, **1.27m ON** before; **446k OFF / 475k ON** after, before transaction-control statements and relation expansion. Processing claim transactions alone add up to 345,600 BEGIN/COMMIT commands/day before versus 115,200 after. These are estimates, not billing counters.

Heartbeat writes: processor 5,760/day plus publisher 17,280/day before = **23,040/day**. Healthy idle after = **11,520/day** combined. Publisher active send cycles remain 5s; idle heartbeat interval is stored as 15s and remains inside the 45s acknowledgement freshness requirement.

## Large recurring queries

1. `provider-guard.ts::readCapacityRows`: full relevant provider audit metadata over max(rolling 24h, Pacific day), every 30s plus each actual guarded request. A window containing K rows is transferred roughly 2,880*K times daily from observation alone. Atomic cost reservation reads are correctness-critical; no cache introduced.
2. `engine.ts::eventSnapshot`: all canonical events/latest facts, twice per accepted matching path (before matching and transaction consistency check). Previously loaded whole NewsItems, Publications and matched SourcePosts, including unused large text/JSON. Now selects the same event facts/IDs/revision/timestamps/publication status only. No event window or facts removed; matching snapshot semantics retained.
3. `automatic-delivery.ts`: owned publication history used only IDs, statuses and news IDs; frozen text, formatted snapshots and transport results were repeatedly transferred unnecessarily. Narrowed. Full candidate include and fresh eligibility checks retained.
4. Operations overview and news feeds/details read large processingResult/relevanceResult/evidence JSON. Actual visit frequency and bytes **unverified**; no speculative UI/cache rewrite performed.
5. Idle safety reads fetched full AppSettings including policy JSON; processor safety/hold selects now return only the required scalar. Publisher heartbeat returns only policy JSON.

## Interpretation

Application inefficiency is demonstrated. Exact contribution to 5.75 GB and post-fix GB/month remain unverified while SQL is unavailable. Query count is not equivalent to egress bytes; reduction estimates must not be presented as a matching percentage reduction in billing.

Expected reductions: about 67% in empty processing/publisher cycles; about 50% in combined healthy-idle heartbeat writes; complete removal of unused payload columns from matching and publisher history queries. Ingestion pages/checkpoints, source authorization, editorial gates, atomic cost guards, duplicate protection and send-claim semantics are unchanged.

These changes do not restore an exhausted quota. Whether optimized traffic fits Free remains uncertain. Lowest-cost safe step: ask Neon for quota relief or await reset, then measure the optimized version. A paid plan requires separate approval; no upgrade or production configuration change is part of this audit.
