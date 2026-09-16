# Phase 1 file inventory

Neon follow-up adds `neon.ts`, `scripts/prisma-neon.mjs`, `scripts/verify-database.mjs`, and `docs/NEON.md`; updates package manifests, ignore rules, README and the environment variable template. Schema and migration files are unchanged.

All files listed below are new; the repository was empty. Local environment files, dependency directories, build outputs and temporary test database/runtime files are ignored and excluded.

```text
.dockerignore
.github/workflows/ci.yml
.gitignore
Dockerfile
README.md
compose.yaml
config/environment.example
docs/ARCHITECTURE.md
docs/FILES.md
docs/VALIDATION.md
eslint.config.mjs
next-env.d.ts
next.config.ts
package-lock.json
package.json
prisma/migrations/202609150001_foundation/migration.sql
prisma/migrations/migration_lock.toml
prisma/schema.prisma
prisma/seed.ts
src/app/actions.ts
src/app/api/health/route.ts
src/app/error.tsx
src/app/filtered/page.tsx
src/app/globals.css
src/app/layout.tsx
src/app/loading.tsx
src/app/logs/page.tsx
src/app/news/[id]/page.tsx
src/app/not-found.tsx
src/app/page.tsx
src/app/posts/[id]/page.tsx
src/app/published/page.tsx
src/app/review/page.tsx
src/app/settings/page.tsx
src/app/sources/page.tsx
src/app/system/page.tsx
src/components/forms.tsx
src/components/navigation.tsx
src/components/news-feed.tsx
src/components/ui.tsx
src/lib/adapters.ts
src/lib/auth.ts
src/lib/db.ts
src/lib/domain.ts
src/lib/labels.ts
src/lib/queries.ts
src/lib/source-service.ts
src/proxy.ts
src/worker/index.ts
tests/database.test.ts
tests/domain.test.ts
tests/http.test.ts
tests/seed.test.ts
tsconfig.json
```

## Phase 2 additions

- `src/lib/processing/rules.ts`: complete versioned editorial catalogue and PDF provenance.
- `src/lib/processing/contracts.ts`: provider schemas and source evidence validation.
- `src/lib/processing/editorial.ts`: protected spans, deterministic edits and review gates.
- `src/lib/processing/matcher.ts`: layered semantic event decisions.
- `src/lib/processing/engine.ts`: ingestion, polling, job claims, retries and transactional persistence.
- `src/lib/processing/providers.ts`: fixture and unavailable-provider implementations; publishing disabled.
- `src/lib/processing/source-profile.ts`: audited source classification.
- `src/app/events/page.tsx`: duplicate, material-update and uncertain-match views.
- `src/components/processing-details.tsx`, `post-feed.tsx`, `source-profile-form.tsx`: inspection and source verification UI.
- `prisma/migrations/202609160001_processing/migration.sql`: additive fields/enums and immutable-evidence trigger.
- `tests/fixtures/processing.ts`, `tests/processing.test.ts`, `tests/processing-database.test.ts`: Phase 2 fixtures and unit/integration tests.
- `docs/PHASE2.md`: source-to-code mapping, limitations, deployment and worker operations.
