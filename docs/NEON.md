# Neon connection — Phase 1

## Configuration

- Project: `crimson-surf-53055533`
- Branch: `production` (`br-steep-river-b2c5fcdd`)
- Database: `neondb`, application schema: `public`
- `neon.ts` declares exactly `auth: true` via `@neon/config/v1`.
- Neon CLI 4.18.0, `@neon/config` and `@neon/env` installed by `neon config init`.
- The requested Neon skills are installed locally. `neon mcp -y` configured the local Codex, Copilot CLI and VS Code clients; its credential is stored in user configuration outside the repository.

`neon deploy` applies backend service configuration, not the Next.js web application. The plan and apply reported no changes: the branch already had Postgres and Neon Auth. Existing HTTP Basic dashboard authentication is preserved; Neon Auth is not integrated into application routes. No Phase 2 functionality was added.

## Reconnect from another checkout

```sh
npm ci
neon login
neon link --project-id crimson-surf-53055533 --branch production -y
neon env pull --file .env --service postgres --service auth
npm run db:neon:status
```

Supply `ADMIN_USERNAME` and `ADMIN_PASSWORD` locally before running the web application. Neon env pull preserves unrelated settings. Never share connection URLs in logs, source code or Git.

The local `.neon` pointer, `.env` files, MCP configuration and installed agent skill directories are ignored. `config/environment.example` lists variable names with empty credential values. Deployment platforms must receive database and administrator secrets through their environment/secret configuration.

## Apply existing migrations and seed

```sh
npm run db:neon:migrate
npm run db:seed
npm run db:verify
```

`db:neon:migrate` runs `prisma migrate deploy` with `DATABASE_URL_UNPOOLED` supplied to the child process as `DATABASE_URL`. It never rewrites the schema or the application's pooled connection. `db:neon:status` uses the same direct connection for a status check. The existing `db:migrate` command remains available for local PostgreSQL and Docker Compose.

`db:verify` is read-only. It checks the existing foundation migration, the five initial enabled sources, and singleton `REQUIRE_APPROVAL`. It deliberately fails if the operator later changes those defaults; it never resets them. The existing seed is idempotent and preserves existing source/settings choices.

## Verification performed

The existing `202609150001_foundation` migration applied successfully to Neon. Seed completed. Read-only Prisma verification confirmed:

- Telegram: `irna_arabic`, `isna94`, `alalamtv`
- X: `alarabiya`, `sputnik_ar`
- Singleton settings: `REQUIRE_APPROVAL`
- Migration status: up to date

The Prisma schema and migration SQL remain byte-for-byte unchanged from Phase 1. No `db push`, reset, introspection rewrite or replacement migration was used.

The mutation-based integration suite must run against a dedicated local or disposable test database, never this production branch. Set `TEST_DATABASE_URL` and the production test server's `DATABASE_URL` to the same isolated test database. Leave those test variables unset for normal app execution against Neon.

### Results on 2026-09-15

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run db:validate`: passed.
- `npm run build`: passed (Next.js production build).
- Existing complete test suite: **12 passed, 0 failed, 0 skipped**, using isolated local PostgreSQL and a production test server on loopback port 3017.
- `npm run db:verify` against Neon: passed.
- `npm run db:neon:status`: up to date.
- No production test fixtures or changes to publishing mode were made by the tests.

`npm audit` reported three high-severity package entries from one existing tooling-chain advisory: `prisma` → `@prisma/config` → `deepmerge-ts` 7.1.5, [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx). These packages/versions predate the Neon configuration. The reported issue concerns recursive object graph merging. No automatic breaking fix was applied; resolve separately with a compatible Prisma tooling update. This did not fail the requested lint, typecheck, tests or build.

## References

- [Neon branch linking and environment files](https://neon.com/blog/branch-first-dev-loop)
- [Neon configuration deployment](https://neon.com/blog/introducing-neon-ts)
- [Neon and Prisma connection support](https://neon.com/blog/better-postgres-with-prisma-experience)
