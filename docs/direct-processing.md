# Direct Processing Sources

## Administrative policy

`Source.processingMode` is an enum (`NORMAL`, `DIRECT`) with a database default of `NORMAL`. The additive migration changes no existing source to DIRECT. Both Telegram and X source forms expose the same ADMIN-only field. The server action authenticates ADMIN before mutation. Row-locked mode changes record the actor, source ID, old/new values and audit timestamp. Create/restore also records the selected mode. Mode is read from the database at each processing attempt, not environment configuration. In-flight mode changes prevent the old decision from being committed and retain the job for a new attempt.

DIRECT is a human decision about **scope only**. It does not establish truth, identify a speaker, verify a source identity, remove a source flag, or approve a human-edited draft. Source verification and all non-scope review requirements remain independent.

## Processing paths

- NORMAL: existing local scope gate and extraction/classification pipeline, unchanged.
- DIRECT Arabic: exact same-source duplicate shortcut when a validated preceding text exists within the existing dedup window; local language detection; one combined verbatim extraction/safety-label request; local immutable ID assignment; existing ID/speaker/evidence validation; event matching; local constrained Arabic rendering and editorial validation; existing review/approval decision.
- DIRECT Persian/other supported language: one combined extraction/safety/proposed-Arabic request. Code validates original evidence, assigns IDs, and checks numeric/date/quote integrity without trusting the proposals. A second independent request receives the full original source, source units, validated extraction and proposed Arabic. Every source unit and rendering must be accounted for; missing/uncertain material coverage fails closed. Only then is a rendering receipt created. The final publication draft is rendered locally. Unknown language still fails closed.
- Empty content requires no AI and cannot publish. Exact-text duplicates require no AI and create a traceable duplicate decision, not another candidate.

The combined DIRECT extraction contract omits relevance and topic entirely. Scope is assigned locally from the source setting; topic stays UNKNOWN without requesting speculative geography. Safety exclusions (advertising, satire, rumour, opinion, incitement), priority including archive-only material, serious claims, sensitive actors, leader status, rank uncertainty, per-assertion kind and material labels remain. The existing ID classification adapter validates those labels and copies all factual data locally. A speakerless assertion cannot become an attributed statement.

Baseline requests for a new accepted story, excluding conditional semantic comparisons and retries:

| Source text | NORMAL | DIRECT |
|---|---:|---:|
| Arabic | 2 | 1 |
| Persian / supported non-Arabic | 4 | 2 |
| Exact validated same-source duplicate in window | existing pipeline | 0 |

There was no separate relevance-only HTTP request in NORMAL: relevance was part of extraction. DIRECT removes the separate classification HTTP request by returning its necessary safety labels alongside extracted assertions. For non-Arabic DIRECT, proposed translations are attached individually to evidence objects in that first request, eliminating the separate translation request. Generation and independent review remain distinct. There is no model-generated title/body or standalone publication-rewrite request, and no one-call non-Arabic design.

Retained: unique-context resolution; exact-substring evidence; completeness; speaker/attribution; no inferred identities, nationality, ownership or event times; immutable fact IDs; Arabic, number, name, date and quote checks; independent translation review; final sentence provenance; editorial rules; source identity/flags; semantic matching; historical publication immutability and durable single-send claims.

## Capacity and measurement

Provider quotas, budgets, concurrency and retry policies are unchanged. Provider capacity waits, including `PROVIDER_COST_WAIT`, are technical processing waits with no synthetic `UNSUPPORTED_OUTPUT` review reason. The durable RETRY job remains available for later processing.

`PROCESSING_ATTEMPT_STARTED` records the effective processing mode. `AI_STAGE_USAGE` records that attempt's mode alongside existing request stage/status, replay flag, tokens, estimated cost and duration. Do not count replay events as paid requests. Processing results and final decision audits record mode; completed publishing-decision audit includes attempt duration. Existing attempt-finished/decision-committed events provide total processing/queue latency and can be joined by SourcePost ID. Telemetry uses no additional AI request. Usage is estimated at configured application prices, not provider-billed measurement.

## Publishing boundary

DIRECT does not enable publishing. Existing manual approval and human-edited approval remain unchanged. All four production flags remain untouched by this change.

The canonical ingestion/processing worker explicitly requires publishing to be disabled and SHADOW_MODE enabled. It remains draft-only. The old local controlled-auto experiment is not deployed or used by this feature.

An optional separate delivery entry point, `src/worker/direct-publisher.ts`, provides the unattended DIRECT path without changing the ingestion worker. It calls `publishReadyDirect`, shares the existing evidence/provenance freeze checks and the existing Telegram single-send implementation, and never selects existing PENDING publications. It requires explicit AUTO_PUBLISH=true, REQUIRE_APPROVAL=true, TELEGRAM_PUBLISH_ENABLED=true and SHADOW_MODE=false **in its own delivery process**. Shadow mode continues to block all automatic sends; it is not bypassed. Neither this process nor those flag changes are activated by implementation or migration. Starting it requires separate production authorization.

Eligibility is rechecked under the editorial lock: clean validated DIRECT output, current enabled DIRECT Telegram sources, complete jobs and resolved event match, no human draft, no existing publication, no review/error. The destination comes solely from the configured Telegram publisher; WEB is unavailable in this entry point. Source permission is rechecked before transport. Concurrent/repeated selections cannot freeze/send a second publication. Failed/unknown outcomes stop the dispatcher; crashes leaving a frozen PENDING/SENDING record require reconciliation, never automatic resend. Source mode changes do not rewrite frozen historical content.

For a future separately authorized delivery service, the entry command is `node --import tsx src/worker/direct-publisher.ts`. Do not replace the existing ingestion worker command, start this service, change flags, or deploy it as part of this implementation verification.

## Release boundary

Apply the additive migration before deploying code that reads the new column, using the existing controlled migration procedure only after approval. Existing rows receive NORMAL; no editorial data, checkpoints, sessions, or publications are rewritten. No indexes or foreign keys are changed. No sources were modified in production during development. Tests mutate isolated localhost databases only and mock all external transports.

## Two-call contract and failure boundaries

`direct-bilingual.ts` owns the strict combined schema and independent full-source review. Arabic fields remain proposals; they are stripped before existing extraction validation. IDs and offsets are assigned locally and proposals attached by structural position, never by model-generated identifiers. Local rendering checks run before the independent review request. The response budget stays 4,096 tokens for both requests, with thinking disabled. The 160,000-character input guard is unchanged. Inputs are never sliced and incomplete/invalid model responses fail closed.

The reviewer receives the complete original source plus locally identified non-empty source lines, original evidence offsets, explicit speaker associations and Arabic proposals. Every source line must be accounted for with supported fact IDs, or explicitly classified as non-factual with a reason. Missing/uncertain material fails. Referencing an unrelated fact, skipping/duplicating a unit, labeling extracted assertions as non-factual, or omitting known facts fails local validation. A speaker heading can be covered by the facts with that exact speaker evidence. Full-source semantic completeness still requires independent model judgment; deterministic checks cannot prove all semantic equivalence or detect every reviewer mistake.

Successful receipts preserve a source-hashed full-source coverage result. The engine and unattended-delivery eligibility recheck it; old non-Arabic DIRECT results without it cannot silently become eligible. NORMAL receipts and the Arabic DIRECT path remain unchanged. DIRECT non-Arabic outer checkpoints use a new contract namespace so legacy three-call outputs cannot bypass coverage review. Native per-request checkpoints reuse a completed combined request after a definite recoverable review failure; ambiguous outcomes retain existing no-blind-retry behavior.

Long/dense posts may exceed the unchanged response/input budget and remain blocked. No budget, quota, concurrency or output-limit increase is included. Offline tests validate these boundaries and mocked review decisions, not real-model quality or measured live cost savings.

## Verification

Final local verification: 57 test files, 333 tests: 327 passed, 0 failed, 6 skipped. The six skips are opt-in HTTP checks without an enabled test server; the unrelated untracked controlled-auto experiment was excluded. The 17 new bilingual contract tests and 9 DIRECT processing tests passed. Typecheck, full lint, Prisma validation, production build, git diff check and task-only secret scan passed. The production build ran in a clean release copy with a placeholder localhost database URL; all database tests used isolated localhost databases and mocked provider/publication transports. No production source modes, flags or data are modified. The migration remains the earlier additive NORMAL-default source-mode migration; this two-call revision requires no additional database migration.
