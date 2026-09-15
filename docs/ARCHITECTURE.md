# Architecture and phased plan

## Repository inspection

The public GitHub repository cloned successfully and contained only Git metadata, no commits, source files, configuration or existing application. Phase 1 starts one application in this repository. There is no Project model, tenant ID, team model or project creation flow.

## Exact MVP architecture

- Next.js App Router and React: server-rendered Arabic RTL admin UI; server actions handle validated mutations.
- HTTP Basic authentication for one administrator, enforced by the Next.js proxy and again in mutation actions. Keep the deployed app behind HTTPS. Server Actions also enforce Next.js origin protections.
- PostgreSQL via Prisma: sole persistent source of truth; transactions include source/settings changes and their audit entries.
- One Node/TypeScript worker in the same repository. Phase 1 only registers heartbeat and shutdown state. A PostgreSQL job table reserves space for Phase 2 leasing, retry and stage transitions; no queue consumer exists yet.
- Adapter contracts isolate authorized monitoring, AI and publishing. There are no platform calls or provider implementations in Phase 1.
- Docker Compose coordinates database → migration/seed → web/worker. No Redis or additional service is needed for the initial MVP.

## Database model

| Model | Responsibility and constraints |
| --- | --- |
| AppSettings | Row ID must equal 1; publishing mode defaults to REQUIRE_APPROVAL |
| Source | Platform + normalized handle unique; soft deletion retains history and ingestion cursor |
| SourcePost | Source + external post ID unique; original/normalized text, language, relevance, status, processing-mode snapshot, timing, errors and retries |
| CanonicalEvent | Shared facts/entities/time; provider-tagged embedding reserved for cross-language matching |
| EventRevision | Event + revision number unique; new facts and material-development explanation |
| EventMatch | Post-to-revision relationship; classification, confidence, rationale, matcher version and evidence |
| NewsItem | One item per event revision; Arabic draft, validation, review reasons, quote/evidence data, approval metadata and mode snapshot |
| NewsEvidence | Many-to-many links between news and original posts |
| EditorialRuleSet | Versioned structured rules plus document provenance and approval timestamp; no rules are seeded |
| Publication | One intent per news item, unique local idempotency key, content snapshot, destination, Telegram result, delivery state and retry metadata |
| PublicationAttempt | Numbered attempt history with errors/results/timestamps |
| ProcessingJob | One job per post + stage; attempt counters, availability, lease owner/time, last error |
| AuditLog | Actor/action/entity/message/metadata/time; app exposes no update/delete operation |
| WorkerHeartbeat | Worker phase/state, interval, last seen, startup time and error metadata |

Foreign keys restrict destructive deletion of historical evidence. Additional SQL CHECK constraints enforce singleton settings, positive revisions, confidence range and nonnegative retry counts. Embeddings are stored as a provider-neutral float array in this MVP schema; no semantic comparison is performed yet.

## Event-level deduplication plan (Phase 2)

Source post idempotency handles repeat fetches only. It does not establish that two differently worded reports are the same event.

The future matcher will extract evidence-backed facts from the original language, retrieve candidate events by time/entities/multilingual embeddings, then compare facts to classify NEW_EVENT, DUPLICATE, UPDATE or UNCERTAIN. Reports about the same event attach to its existing revision. Only a material, supported development creates a new revision; uncertain matches require review. Store the rationale and source evidence for every decision. Candidate matching/revision creation must be serialized or locked to prevent two workers creating separate canonical events concurrently.

One news item per event revision and one publication intent per news item enforce local uniqueness. They cannot prevent independently created semantic duplicates; this remains a Phase 2 matcher/concurrency responsibility.

## Editorial configuration boundary

Do not write editorial rules from assumptions. Import the owner's two PDFs with page-level provenance, explicit quote-exclusion behavior, versioning and approval. `EditorialRules` exposes categories without supplying their contents. The future pipeline must validate fact grounding, Arabic output, protected quotes and all review conditions before any story becomes eligible for publishing. A Needs Review result must override AUTO_PUBLISH. This gating is not implemented or claimed as working in Phase 1.

## Publishing idempotency boundary

The unique publication record is an outbox intent. A future sender must claim it atomically and preserve the exact content snapshot. A timeout after Telegram accepts a message is not proof of failure. If delivery cannot be confirmed, store UNKNOWN and stop automatic retries until an operator reconciles it. Do not claim exactly-once delivery from a local key alone: Telegram does not receive a guarantee from that key. On restart, stale SENDING records must be reconciled, never blindly reset to PENDING.

There is no sender in Phase 1. No publishing mode can trigger a network send.

## Fastest phased delivery

1. **Foundation (this implementation):** database/migration/seed, authenticated RTL shell, source management, publishing mode, read-only inspection, logs and heartbeat; verify lint, typecheck, schema, tests and build.
2. **Ingestion and preparation:** first obtain both editorial PDFs and select authorized Telegram/X access. Implement adapters and incremental polling, transactional job leases, relevance/factual extraction, multilingual event matching, quote-aware Arabic editorial pipeline, deterministic validation, review reasons and an approval/edit workflow. Validate with explicitly labeled multilingual fixtures before live credentials are connected. No automatic publishing until the pipeline is evaluated.
3. **Delivery and operations:** single-destination Telegram outbox sender, uncertainty reconciliation, approval/auto gate, rate-aware retries, crash recovery tests, deployment behind TLS and end-to-end acceptance.

### Next concrete Phase 2 step

Supply `Publishing Prompt.pdf` and `مرجع المصطلحات - ايران الآن.pdf`, then select the authorized monitoring adapter/API access for the configured sources. Start with a fixture-based ingestion job and event-matching evaluation set, keeping REQUIRE_APPROVAL. Do not invent the missing document rules.

## Documentation references

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js ESLint configuration](https://nextjs.org/docs/app/api-reference/config/eslint)
- [Prisma 6 schema reference](https://docs.prisma.io/docs/orm/v6/reference/prisma-schema-reference)

Versions are locked in package-lock.json. Prisma 6 is an explicit choice for the established PrismaClient generator and schema datasource configuration used here.
