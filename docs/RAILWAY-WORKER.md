# Always-on Telegram worker — prepared, not deployed

## Scope and command

One persistent Railway **worker service**, one replica: Telegram ingestion plus
serial Gemini 3.1 Flash-Lite processing. The dashboard stays on Vercel, all durable
application state stays in the existing Neon database. No schema migration, seed,
Telegram publishing, X integration, new database, volume or message queue.

Exact production start command (Node is PID 1, receives SIGTERM directly):

```sh
node --import tsx src/worker/production.ts
```

`npm run worker:production` is the equivalent convenience command. Production
expects runtime environment variables; it does not load `.env`. Existing `worker`
is the old unconfigured foundation loop. Do not use it as the Railway start
command. `telegram:authorize` is an interactive local session recovery tool only.

## Runtime configuration — names, never secret values

Required secrets, copied privately from the existing secure local configuration
into Railway **service Variables**, then sealed:

- `DATABASE_URL` — existing Neon pooled PostgreSQL URL, including TLS parameters.
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- `GEMINI_API_KEY`

Required safeguards (not secrets):

```dotenv
SHADOW_MODE=true
REQUIRE_APPROVAL=true
AUTO_PUBLISH=false
TELEGRAM_PUBLISH_ENABLED=false
```

`NODE_ENV=production` is set by the worker Dockerfile. Railway supplies `PORT`;
the local default is 3001. No model variable is needed: this worker uses the
existing fixed `gemini-3.1-flash-lite` provider with thinking disabled.

The actual approval gate also reads **AppSettings.publishingMode=REQUIRE_APPROVAL**
from Neon at startup, continuously, and before every new provider request.
Environment flags cannot override that setting. The worker fails closed on an
unsafe environment or database mode; it never changes either to get past a check.

Do not put `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, dashboard admin credentials,
OpenAI/Groq keys, or Neon management credentials in this service. Publishing is
a separately authorized operation; the worker has no publisher call path.
`DATABASE_URL_UNPOOLED` is not needed: no migrations or session advisory locks run.

## Telegram session persistence

`StringSession` already serializes the authenticated account's auth key and data
center connection. Store the existing `TELEGRAM_SESSION` as a **sealed Railway
variable**. It is restored from that variable on every restart; no interactive
login and no disk volume are required. Do not put a session file in the image,
repo, build arguments, logs, or CLI arguments. The Dockerfile copies only explicit
source paths; `.env*` and `*.session*` are ignored by both Git and Docker.

Stop every local Telegram reader/processor using this account/session before
cutover. Do not run a local copy simultaneously with Railway. The new production
worker uses a shared database lease so only one new-worker instance connects the
session during deploy overlap. Existing local tools do not participate in that
lease. Do not create a replica, preview deployment or second service sharing this
production session.

If Telegram revokes/expires authorization, the worker exits with
`TELEGRAM_AUTHORIZATION_REQUIRED`; it does not attempt interactive login. Perform
`npm run telegram:authorize` privately on the trusted local machine, replace the
sealed session variable, then redeploy after approval. Never paste it in chat.
`TELEGRAM_SESSION_CONFLICT` means Telegram detected concurrent use of the auth
key. Stop other readers and reconcile the session before restarting. Temporary
transport failures remain retryable; the direct authorization probe does not
mistake network failure for a revoked login.
`TELEGRAM_SESSION_INVALID` means the saved variable is malformed; replace it
privately with the existing valid local session, without attempting cloud login.

## Recovery and duplicate protection

- Polls enabled, non-deleted sources dynamically from Neon on every cycle. Only
  the Telegram adapter is registered; no hardcoded source handles. Existing
  channel-ID pinning, verbatim evidence and cursors remain unchanged.
- New sources establish the latest-message boundary; existing cursors resume
  in oldest-first batches of up to 50. Cursors advance only after the batch
  commits. Replay uses unique source/post and job keys; it cannot duplicate rows.
- One serial processing loop uses existing atomic job claims, opaque claim
  tokens, five-minute job leases and the serial event decision lock. Stale
  claims are now rejected before a provider call; the final transaction locks
  the job row as well. Completed/approved/published items are never queued again.
- A 90-second database-clock worker lease uses the existing WorkerHeartbeat
  table. Renewal is fenced by a run UUID every 15 seconds. Standby instances do
  no Telegram/AI work. Lost ownership aborts the active loops. A watchdog exits
  before lease expiry if database probes stall.
  Database timestamps are explicitly UTC to match Prisma, independent of the
  PostgreSQL session timezone.
- Telegram/DB recovery uses bounded exponential backoff with jitter, capped at
  five minutes. Telegram flood-wait cooldown remains shared across sources.
  Connection recovery destroys the old client before constructing another.
  A timed-out poll is aborted and drained before another poll can start; an
  operation that cannot drain exits the process instead of allowing overlap.
- Jobs have a 180-second processing abort signal and a 210-second supervisor
  deadline. SIGTERM stops new work, aborts active calls, closes Telegram and DB,
  and records STOPPED. Forced shutdown is bounded at 45 seconds; Railway must
  provide 60 seconds to drain. Unfinished job leases are recoverable.
- Successful `understand`, `compare`, and `draft` provider stages are checkpointed
  in AuditLog outside the event transaction, keyed by provider/version/stage and
  exact input. A retry reuses the checkpoint and still runs the existing strict
  validators. Prompts, contracts and validators are unchanged.
- If a provider stage was started but its completion is unknown, automatic replay
  stops with `PROVIDER_STAGE_OUTCOME_REQUIRES_REVIEW`. Do not delete its intent or
  requeue it blindly: reconcile the saved usage/output and explicitly authorize
  recovery. There is no claim of exactly-once delivery by an external AI API.
- Validation failures remain failures and retain their exact error; no fallback
  facts or automatic editorial attestations. Failed jobs pause processing for
  five minutes before another job, to limit rapid spend during failures.
- No automatic provider fallback. Gemini retains its existing single retry only
  for HTTP 503. No automatic publication or approval is possible.

## Setup steps AFTER explicit cost/deployment approval

1. Use the reviewed worker commit on `main` in
   `https://github.com/promots-software/iran-todayy`. Vercel currently has no
   connected Git repository (checked 2026-09-17); no dashboard settings were
   changed. If a Git integration is added later, review its deployment triggers
   before pushing further worker changes.
2. Confirm the Neon production project's current compute plan/allowance can fund
   a full month of continuous operation (cost section below). Do not activate
   a paid Neon or Railway plan without explicit approval.
3. In Railway, use an approved workspace/plan and create **one empty persistent
   service** named `iran-today-worker`. Configure before deploying. No Cron,
   serverless sleeping, public domain, database add-on, volume or preview service.
4. Connect the approved GitHub repository/branch containing these files. Initially
   leave automatic deployments disabled until the first cutover is verified.
   Service root is the directory containing package.json (repository root when
   the Iran Today project itself is the repository).
5. Build with Docker; set `RAILWAY_DOCKERFILE_PATH` to `Dockerfile.worker` in service
   variables. It runs `npm ci --include=dev` and `prisma generate`, and copies only
   worker/library sources. It does **not** build Next.js, migrate, seed or read
   production secrets during its Docker steps. Leave pre-deploy command empty.
6. Set start command exactly as above. Set **one replica**, **Serverless OFF**,
   **Restart policy Always**, **overlap 0 seconds**, **drain 60 seconds**. Use the
   region nearest the existing Neon production endpoint. Start with a 1 GB RAM /
   1 vCPU resource ceiling and inspect actual usage after cutover; billing uses
   resources consumed, not the ceiling. Do not scale replicas.
7. Set the five secret variables and four safeguards above. Use the variable menu
   to **Seal** each credential. Sealed values cannot be read back; retain the
   secure local originals. No secrets in GitHub or build arguments.
8. Set Healthcheck Path `/healthz`, timeout 180 seconds. Optional equivalent
   Railway variables: `RAILWAY_HEALTHCHECK_TIMEOUT_SEC`,
   `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`.
9. Set a Railway usage alert appropriate to the approved budget (initial host
   estimate $5–8/month). A hard spending cap stops services when reached, so
   choose its reliability tradeoff explicitly. AI and Neon billing are separate.
10. Stop local workers, review all staged changes and credentials, then deploy
    **only after authorization**. Starting this service starts live ingestion and
    paid AI processing of eligible queued/new posts, while publishing stays off.

These steps use service settings, not the deprecated legacy Railway config-as-code
format. No Railway resource has been created by this preparation.

## Health, logs, and post-deployment verification

- `/healthz` returns 200 with `role:active` or `role:standby` after successful
  database/safety checks; returns 503 when stopping or the last DB check is stale.
  Standby is intentionally startup-healthy so Railway can drain the old holder
  before it hands over the shared Telegram session. HTTP 200 alone is **not**
  proof that Telegram is authenticated or processing is progressing.
- The authoritative active heartbeat is `WorkerHeartbeat.id` =
  `telegram-production-worker`. Expect `lastSeenAt` to advance every 15 seconds,
  `phase=PROCESSING`, and metadata `liveMonitoringEnabled=true`,
  `processingEnabled=true`, `externalPublishingEnabled=false` after connection.
  Existing dashboard heartbeat staleness logic works with this row.
- Railway's startup healthcheck is not continuous monitoring. Inspect the
  existing dashboard heartbeat and Railway process logs/metrics regularly.
- Logs: `WORKER_STARTING`, `WORKER_LEASE_ACQUIRED`, `TELEGRAM_CONNECTED`,
  `SOURCE_POLL`, `WORKER_HEARTBEAT`, `JOB_FINISHED`, `AI_STAGE_USAGE`, safe retry
  codes, and `WORKER_STOPPED`. They exclude source text, credentials and raw
  Telegram/Prisma errors. Token/cost usage is also persisted in AuditLog.
- In Railway's container shell, a read-only health probe is:

  ```sh
  node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/healthz").then(async r=>{console.log(r.status,await r.text());process.exitCode=r.ok?0:1})'
  ```

- After deployment: verify the active heartbeat, safe modes, enabled source
  polling and normal review-only outcomes. Perform one controlled worker restart
  after approval; verify cursor continuation and no duplicate source posts,
  jobs, events or publications. No messages should be sent by this service.
- Authorization/permission failures require operator action; generic connection
  failures retry. Unknown provider-stage outcomes require reconciliation. Check
  `Source.lastError`, `ProcessingJob.lastError`, and AuditLog for details.

## Cost review — no plans activated

Official prices checked 2026-09-17:

- **Railway Hobby:** $5 monthly minimum including $5 usage. RAM $10/GB-month,
  CPU $20/vCPU-month, egress $0.05/GB. For an estimated 0.25–0.5 GB average RAM
  and 0.02–0.1 average vCPU, budget approximately **$5–8/month** initially; this
  is an estimate, not measured production use or a hard limit. Hobby is the
  lowest paid tier with unrestricted Always restart; Pro ($20 minimum) adds
  team/production features but is not automatically needed or activated.
- **Neon consequence:** continuous polls/heartbeats prevent scale-to-zero. At
  0.25 CU and 730 hours/month, compute is approximately 182.5 CU-hours/month.
  Current Free allowance is 100 CU-hours/project, so Free would not cover a
  full month. If this project is Free, the unchanged architecture needs an
  approved paid Neon plan for 24/7 operation. Launch at $0.106/CU-hour is about
  **$19.35/month compute**, plus storage/history/egress (storage $0.35/GB-month).
  Higher compute sizes increase this estimate. Current account plan not queried
  or changed in this task. Expected combined host + minimum DB is roughly
  **$25–30/month plus AI**, subject to actual usage.
- **Cheaper alternative:** keep local worker operation for limited hours using
  existing infrastructure, with laptop/network uptime limitations. Continuous
  Railway Free credits do not fund reliable full-month operation. Reducing Neon
  runtime substantially would mean a different polling/state architecture or a
  database move, outside this requested minimal preparation.
- Gemini usage is separate, unchanged, and depends on accepted posts/stages.
  No new provider calls or paid services are activated in this preparation.

Sources:
- https://docs.railway.com/services
- https://docs.railway.com/pricing/plans
- https://docs.railway.com/deployments/restart-policy
- https://docs.railway.com/deployments/deployment-teardown
- https://docs.railway.com/deployments/healthchecks
- https://docs.railway.com/variables
- https://docs.railway.com/config-as-code/reference
- https://docs.teleproto.dev/faq
- https://neon.com/pricing

## Verification in this preparation

Focused offline tests cover safe configuration, cancellation/backoff, cursor
replay, dynamic source enable/disable, stale claim rejection before AI, overlapping
worker leases, database-backed checkpoints, uncertain stage recovery, and the
existing pipeline concurrency/review/dedup paths. AI transports and Telegram
readers are mocked; database tests use isolated localhost PostgreSQL, never Neon.
Result: **20/20 focused tests passed, zero skipped**. TypeScript and scoped ESLint
passed. The actual entry-point smoke test passed standby startup, HTTP 200 health,
404 for unknown paths, original-lease preservation and graceful SIGTERM handling
with fake credentials and zero Telegram connections. Git-visible scan checked
149 files and found zero matches for the saved secret values checked. The
isolated test database was used, not Neon. Final commit verification independently
checked the 119-file staged tree and its dependency closure: no missing imports,
private artifacts or secret matches. The 53 changed files include the worker's
previously uncommitted runtime dependencies and focused regressions. Dashboard,
publisher and benchmark runners remain outside this commit. All 103 selected
offline tests passed after correcting stale test expectations for the existing
strict ID-only classification and final-title provenance behavior (42 affected
tests rerun, zero skipped). Scoped lint and staged-tree typecheck also passed.
An offline `npm ci --dry-run --ignore-scripts` verified the install manifest;
the lockfile includes the transitive resolver entries required for a clean install.

A Linux Docker/Railway build and
real deployed Telegram reconnection remain post-approval verification; Docker
is not installed on this local machine. No full Next.js build is necessary for
this worker-only image. No production database schema or dashboard change.
