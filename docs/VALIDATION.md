# Phase 1 validation — 2026-09-15

## Environment

- Windows, Node 24.10.0, npm 11.6.1.
- Locked dependencies: Next.js 16.3.5, Prisma 6.19.3 (see package-lock.json for all versions).
- A dedicated local PostgreSQL 18.4 instance was used for migration and integration checks. Runtime binaries were downloaded to ignored `.test-tools/`; database files live in ignored `.test-db/`. This is test tooling, not an application dependency or an API integration.
- Docker is not installed in this environment. Compose targets PostgreSQL 17 and Node 22; the Docker image/Compose stack and GitHub Actions workflow were not executed here.

## Results actually observed

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, no warnings/errors |
| `npm run typecheck` | Passed |
| `npx prisma format` | Passed |
| `npm run db:validate` | Passed |
| `npm run db:generate` | Passed |
| `npm run db:migrate` | Initial migration applied successfully to PostgreSQL |
| `npx prisma migrate status` | Database schema up to date |
| `npm run db:seed` | Passed; five requested sources created |
| `npm test` with both integration options | 12 passed, 0 failed, 0 skipped |
| `npm run build` | Passed; optimized production build and Next.js TypeScript check completed |
| Production server `npm start` | Started successfully on loopback port 3000 |
| Worker lifecycle | Multiple heartbeats observed; SIGINT produced `worker_stopped`, persisted STOPPED and start/stop audit entries |

The Windows terminal reported interrupt exit code 1 when SIGINT was sent; the worker's final log and database writes confirmed its shutdown handler ran. This is not a claim that a normal process exit returned code 0.

## Test coverage

1. PostgreSQL source create/duplicate rejection/enable/disable/remove/restore; audit persistence; repeated post rejection; processing-mode snapshot; singleton constraint; unique news per event revision; racing publication inserts; material-development revision storage.
2. Five initial source definitions and URL normalization.
3. Handle normalization and invalid input rejection.
4. Unsafe source-link rejection.
5. Publishing mode validation.
6. Authentication fail-closed cases.
7. Worker stale-heartbeat calculation.
8. Exponential retry delay and Retry-After precedence.
9. Production route responses, unauthorized HTTP 401, health HTTP 200, Arabic/RTL shell and security headers.
10. Real progressive-enhancement form submissions to source/settings Server Actions: add, duplicate/invalid input feedback, disable, enable, remove and both publishing modes, verified against database records.
11. Populated `/news/[id]` and `/posts/[id]` responses containing stored source evidence, Arabic test content and review/duplicate explanations.
12. Rerunning the seed preserves source removal/disable choices and AUTO_PUBLISH rather than resetting operator settings.

After tests: five initial sources, zero source posts/news/events, REQUIRE_APPROVAL restored. Fixtures were explicitly test-only content and were removed.

The temporary web, worker and PostgreSQL processes were stopped after verification. The ignored local `.env` points to that stopped test instance; configure your own database using `config/environment.example` before normal startup. No remote deployment or GitHub push was performed during the Phase 1 validation run.

## Reproduce the full suite

Use a dedicated database. Apply migration and seed, build and start the web app against that same database, then set:

- `TEST_DATABASE_URL` to that database connection string.
- `TEST_BASE_URL` to the running server, e.g. `http://127.0.0.1:3000`.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` to the same values used by that server.

Run `npm test`. With neither test environment option, the seven standalone unit tests run and the five database/HTTP tests explicitly skip. Never point integration tests at a live deployment: they intentionally change settings and create/delete fixtures.

## Limitations and recovered environment issues

- The first npm download timed out; retrying with cached packages completed successfully.
- Windows reserved the first selected test database port; using an available port resolved startup.
- Some commands needed execution outside the sandbox because its Windows identity prevented the TypeScript runner from reading OS user information. Those commands passed after escalation.
- The in-app browser refused the localhost URL with `net::ERR_BLOCKED_BY_CLIENT`. No visual screenshot or mobile-browser verification was completed. HTTP tests confirm rendered Arabic markup and live forms, not visual layout or hydrated-client behavior.
- Docker/Compose execution and remote CI remain unverified locally.
- Semantic matching, editorial correctness, provider APIs and real Telegram delivery were not tested because none are implemented in Phase 1.
