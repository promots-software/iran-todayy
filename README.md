# Iran Today — Phase 2

Single-project, Arabic-first RTL political news administration and processing engine. See [Phase 2 implementation, editorial provenance, limitations and operations](docs/PHASE2.md).

## Implemented

- Next.js App Router + TypeScript, PostgreSQL + Prisma, one background worker process in the same repository.
- Authenticated Arabic dashboard, responsive layout, accessible forms, empty/error/loading states.
- Persistent source add, enable, disable, remove and restore. Removal preserves historical posts and audit records.
- Singleton publishing mode, default `REQUIRE_APPROVAL`, with audited changes.
- Canonical events, material-development revisions, source-post relationships, draft/news records, validation and processing statuses.
- Read-only story/post inspection, review queues, published/filtered views, logs and system status.
- Worker heartbeat, structured console logs, database reconnect backoff and graceful shutdown.
- Migration, repeatable seed, Docker Compose, unit and opt-in PostgreSQL integration tests.

**Phase 2:** idempotent ingestion, validated language-provider contracts, layered semantic matching, versioned PDF-derived editorial rules, transactional jobs, retries and dashboard evidence inspection. Language understanding and monitoring are fixture-driven until authorized providers are configured. The worker consumes jobs but holds them for review when its language provider is unconfigured. No live X/Telegram integration, paid AI, approval mutation or external publication is enabled. `AUTO_PUBLISH` never triggers a send in this release.

## Local setup

Requires Node.js 22.13+ (or compatible current LTS), npm, and PostgreSQL 17+.

1. Copy `config/environment.example` to `.env` and set `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`. Use your own long random password. Do not commit `.env`.
2. Run `npm ci`.
3. Run `npm run db:generate`, `npm run db:migrate`, then `npm run db:seed`.
4. Run `npm run dev` and open `http://localhost:3000`. The browser asks for admin credentials.
5. In another terminal, run `npm run worker`.

Prisma CLI and Next.js load `.env` themselves. The seed and worker scripts explicitly load `.env` if present; supplied process environment variables take precedence.

`npm run build` then `npm start` runs the production web app. Pages are rendered dynamically: building does not need a running database or platform credentials. If the database is unavailable, authenticated pages display a truthful unavailable state; writes fail without reporting success.

### Docker Compose

Copy `config/environment.example` to `.env` and fill in the database and administrator values, then:

```sh
docker compose up --build -d
docker compose logs -f web worker
```

Compose starts PostgreSQL, applies migrations and seeds once through a dedicated service, then starts web and worker. Seed reruns do not reset source choices or publishing mode. Postgres and web ports bind to localhost. A production deployment needs a TLS reverse proxy in front of port 3000; Basic authentication must travel over HTTPS. All routes except the minimal health endpoint require authentication. Missing admin credentials fail closed with HTTP 503.

Use URL-safe characters for `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` in this Compose configuration, because they are interpolated into the connection URL. If managing a database separately, supply a correctly percent-encoded `DATABASE_URL`.

Database volumes retain data across service restarts. Back them up before deployment upgrades. The Docker image retains Prisma/tsx tools for migrations and the worker.

## Commands and verification

```sh
npm run lint
npm run typecheck
npm run db:validate
npm test
npm run build
```

`db:validate` requires a syntactically valid `DATABASE_URL`, not a reachable database. For database integration tests, set `TEST_DATABASE_URL` to a **dedicated migrated test database** and run `npm test`. Without it, that test is explicitly skipped. The database test changes singleton settings and deletes its own fixtures; do not point it at production. It verifies source persistence/restoration, audit records, post idempotency, mode snapshots, singleton enforcement, event-revision uniqueness and racing publication inserts.

See `docs/VALIDATION.md` for the checks actually run in this implementation environment.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Overview and latest news |
| `/sources` | Source management |
| `/review` | Needs Review and pending approval lists, read-only |
| `/published` | Confirmed publication records |
| `/filtered` | Filtered/rejected/duplicate posts and news |
| `/news/[id]` | Arabic draft, event, evidence, validation and publication detail |
| `/posts/[id]` | Original post, processing metadata and event relationships |
| `/logs` | Latest 100 audit entries |
| `/settings` | Publishing mode and editorial configuration status |
| `/system` | Database, worker freshness and job counts |
| `/api/health` | Minimal unauthenticated readiness probe; 503 if schema/database unavailable |

Lists are bounded to the latest 100 records for this foundation. All displayed dates use Asia/Beirut. Original-language content uses automatic text direction. No sample news is seeded.

## Environment variables

For the linked Neon production database, see [Neon setup and verification](docs/NEON.md). The Prisma schema remains unchanged; `DATABASE_URL` is the pooled application URL, while `db:neon:migrate` and `db:neon:status` use `DATABASE_URL_UNPOOLED` only in their child process.

| Variable | Phase | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | 1 | PostgreSQL connection string |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | 1 | Single-admin HTTP Basic authentication, server only |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | 1 / Compose | Database bootstrap |
| `WORKER_ID` | 1, optional | Stable identity; unique per running worker |
| `WORKER_HEARTBEAT_MS` | 1, optional | Heartbeat interval, clamped to 1–60 seconds |
| `TEST_DATABASE_URL` | Tests only | Dedicated database for integration tests |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION` | 2, provisional | Authorized Telegram monitoring adapter, if MTProto is chosen |
| `X_BEARER_TOKEN` | 2 | Authorized X API access |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_EMBEDDING_MODEL` | 2 | Provider configuration after adapter selection |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | 3 | Single Telegram publishing destination |

No external credential is needed for Phase 1. No `NEXT_PUBLIC_*` secret variables are used. Editorial PDFs are still needed before implementing editorial policy. [Architecture and phased plan](docs/ARCHITECTURE.md).
