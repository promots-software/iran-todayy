# Functional verification map

This map separates executed offline tests from production read-only checks. A mocked provider response demonstrates application behavior, not actual model understanding. No real delivery is required by this suite.

## Web surfaces and actions

| Surface | Permanent coverage | Boundary |
|---|---|---|
| Login/logout/session | `tests/e2e/workflows.spec.ts`, `dashboard-auth`, `dashboard-user-management` | Real local browser, hashed sessions, invalid/expired/revoked tokens; production smoke read-only |
| Overview, Reviews, Approvals, Published, Events, Filtered | E2E role navigation, `dashboard-pagination`, `newsroom-eligibility` | PostgreSQL pagination >100 rows, stable tie ordering, separate unresolved pages |
| SourcePost/NewsItem editor | E2E save/refresh/approve/re-edit/reject, `human-editorial`, `review-draft`, `review-production-blockers` | Failed AI result retained; human text is never AI-validated |
| Image upload/media endpoint | E2E file input/upload/replace/remove, `dashboard-media-processing` | Local stored PNG; source metadata unchanged; no external media download |
| Frozen Telegram/Web preview and delivery | E2E fake Telegram + local WEB, `dashboard-publication`, `publication-database`, `telegram-publisher`, `telegram-reconciliation` | Exactly one fake transport call; ambiguous sends never automatically repeated |
| Sources | E2E Telegram/X CRUD, modes, enable/disable/remove/restore/profile; `direct-processing`, `deep-state`, `operations` | X configuration supported; no live X connector/credentials used |
| Settings/users | E2E user CRUD, role change/deactivation/settings; `dashboard-auth`, `dashboard-user-management`, `operations` | ADMIN cannot promote SUPER_ADMIN; last-admin protection; password/token hashing |
| Operations/failures/inspector | E2E roles, holds/source controls, `operations`, `deep-state`, `deep-semantics` | No production control mutations; historical workers explicitly distinguished |
| Logs | E2E links, `deep-state` | Original actor plus durable draft/publication foreign-key links, no guessed text IDs |
| System/health | E2E direct access and health startup | Read-only production heartbeat verification separately recorded |

## State families and transitions

| Family | Executed coverage | Explicit limitations |
|---|---|---|
| Roles SUPER_ADMIN/ADMIN/EDITOR | Real browser pages/direct URLs; captured action replay; user/session service tests | No permanent production test users created |
| Source NORMAL/DIRECT, enabled/disabled/deleted, processing hold | Both mode directions during in-flight understanding; disable before commit; CRUD/restart/poll tests | Dynamic database-driven; no live source mode changed |
| SourcePost INGESTED → stages → PENDING_APPROVAL/NEEDS_REVIEW/FILTERED/DUPLICATE/FAILED | `processing-database`, `direct-processing`, `deep-state`, provider checkpoint and language fixtures | Transient stage labels are not independent user actions |
| News PENDING_APPROVAL/NEEDS_REVIEW → human DRAFT → APPROVED → PUBLISHED | E2E + human/editorial/publication DB tests | Human edits preserve original AI failures |
| Human DRAFT/APPROVED/PUBLISHED | Save/approve/edit invalidation/frozen history, sent immutability | Publication destinations are never mutated in place |
| Publication PENDING/SENDING/SENT/FAILED/UNKNOWN/CANCELLED | Database claim races, lost acknowledgement, definite failure, cancellation, replay | Real Telegram failure injection intentionally not performed |
| Job PENDING/RUNNING/RETRY/COMPLETED/FAILED | DB claim concurrency, lease expiry, source changes, terminal technical recovery | No production requeues |
| Match NEW_EVENT/DUPLICATE/MATERIAL_UPDATE/UNCERTAIN_MATCH | Gold replay + matcher/processing DB fixtures | Legacy UPDATE/UNCERTAIN enum labels retained; not emitted by current matcher |
| Relevance UNASSESSED/POLITICAL_NEWS/IRRELEVANT/UNCERTAIN | Extraction, scope and pipeline fixtures | No live provider quality experiment |
| Validation NOT_RUN/PASSED/FAILED/NEEDS_REVIEW | Positive/negative semantic fixtures and preserved processing failures | Independent model acceptance remains a probabilistic dependency |
| Worker STARTING/IDLE/BUSY/STOPPED/ERROR | lifecycle/recovery/lease/heartbeat tests, live read-only heartbeat | No production kill/restart chaos injection |
| Log INFO/WARN/ERROR | Existing worker/audit tests; human audit links | Log levels alone do not grant state transitions |
| Legacy News QUEUED/CLASSIFIED/PROCESSING/RECEIVED | Canonical presentation/enum inventory, existing fixture paths where used | No artificial production transitions invented for obsolete states |

## Failure injection and safety

- Telegram timeout/disconnect/reconnect, invalid session, per-source errors, restart, persistence/checkpoint failure and multiple page sizes/bursts: `telegram-recovery`, `telegram`, `production-worker`.
- 429/503/transport ambiguity, reservations, cost/quota waits, successful checkpoint reuse, stale leases and source-mode races: `realtime-queue`, `cost-safety`, `reliability-database`, `gemini-optimization`, `deep-state`.
- NORMAL and DIRECT automatic eligibility, TEST exclusion, old manual PENDING exclusion, approval safety, concurrency and restart: `automatic-delivery`, `direct-processing`, `telegram-reconciliation`.
- Protected literal quotes, dates/numbers/entities, indirect speech, incomplete material coverage, invalid IDs, attribution/negation/modality, source language and Persian review: DIRECT, rendering, Gold and new deep-semantic regressions.
- All mutating E2E/database tests require loopback PostgreSQL; test credentials are ephemeral; outbound browser/server traffic is blocked or intercepted. No provider worker is started by E2E.

## Reproduction commands

Set `TEST_DATABASE_URL` locally to an isolated loopback PostgreSQL instance; never use production. `npm run test:regressions` creates a fresh database per test file. `npm run test:e2e` creates a fresh `qa_` database and isolated app copy, starts a local server, and uses installed Edge (`E2E_BROWSER_CHANNEL` may select another installed supported channel). `npm run benchmark:direct` defaults to fixture replay; never add live flags for this verification.

The raw route/action/enum discovery is in `functional-inventory.json`. Exact execution counts and any skipped tests are recorded in the release evidence report, not inferred from this map.
