# Phase 2 processing engine

## Status and boundaries

The existing Next.js/Prisma/PostgreSQL application now contains a transactional processing engine and a fixture-driven provider implementation. It is **not a live news feed**: no Telegram/X credentials, paid AI provider, or external publisher are activated. Production keeps REQUIRE_APPROVAL. AUTO_PUBLISH is preserved in the data model but cannot cause a send in this release.

The shipped worker uses `UnconfiguredLanguageProvider`; any queued post is held with PROVIDER_UNAVAILABLE until a reviewed provider is injected. Fixtures only run against the explicitly selected local test database, never as a production seed. Source profiles are deliberately unverified by default; an authenticated operator can record classification and verification evidence in Sources.

## Editorial source audit

Both original PDFs were completely read, including visual inspection of all 37 pages. The repository stores the transcribed structured rules and document SHA-256 hashes, not the PDFs or extracted scratch files.

| Source sections | Application representation |
|---|---|
| Publishing §§2–3, pp2–4 | Eligibility categories, topic, P1–P4, source classes/authority and verification |
| Publishing §2.2, p3 | Inclusive 24-hour semantic repeat window; historical candidates outside it held for review |
| Publishing §4, p4 | Explicit review codes, Arabic explanations and section provenance |
| Publishing §5, pp4–5 | Ordered pipeline audit: filter/match, classify, quotes, automatic/contextual terms, attribution, titles, transliteration, formatting, assembly, final validation |
| Reference I, pp2–10; Publishing §6, pp6–12 | 68 individually identified term rows, alternatives, original automatic/contextual types, evidence conditions |
| Reference II, p11; Publishing §§7–8, p13 | Attribution constraints and literal quote protection |
| Reference III–IV, pp12–13; Publishing §§9–10, pp13–15 | Full first mention, rank checks, complete names/places/institutions list and aliases |
| Reference V–VII, pp14–16; Publishing §11, pp16–17 | Spelling, punctuation, number/calendar/unit/currency constraints |
| Reference VIII, p17 | Breaking/news and platform-format rules; media formats retained in rule data for future adapters |
| Reference IX, p18; Publishing §12, p17 | No invented facts, preserved quotations, grounded figures, uncovered-case review |
| Publishing §13, pp18–19 | Provider task instructions and PDF-derived acceptance fixtures |

`src/lib/processing/rules.ts` is versioned application data. `EditorialRuleSet` snapshots the entire catalogue and provenance when a job completes. Increment its version for any editorial change; do not overwrite old snapshots. The supplied unified reference takes precedence. Its political labels are the owner's editorial rules, not claims of independently verified fact.

### Explicit ambiguities and conservative handling

* Flagged sources: Publishing §2.2 excludes before verification; §4.7 and §13.2 retain for review. Hold the item and record FLAGGED_SOURCE; no automatic readiness.
* The Yemen acceptance example adds a Gaza motive absent from its short input. The reference's factual-preservation rule wins: do not infer the motive, identity, location or cause.
* Several rows marked automatic still have identity or historical preconditions (Syrian forces, 2018 nuclear withdrawal, casualties, Iranian drones). Preserve the original type but require supporting context; unresolved cases remain under review.
* Current military ranks, offices and death status require verification, even when a reference example names a rank. The document is not a live officeholder registry.
* “No برنامج in descriptions” conflicts with required nuclear-programme terminology if interpreted globally. Do not delete factual programme references; ambiguous description labels need review.
* New names need a documented IRNA/Tasnim Arabic spelling; no unverified transliteration or exchange-rate lookup is invented.
* “One event = one publication” versus substantive revisions: the engine creates no publication intent at all. A future publisher must resolve whether a substantive revision edits the existing post or creates an explicitly approved update. Existing revision/publication uniqueness remains intact.

### What is deterministic versus provider-dependent

Exact original evidence offsets, schema shape, fact IDs, sentence coverage, quotation preservation, approved rule IDs/alternatives, name-list membership, source verification, several spelling/terminology replacements, headline format and explicit review gates are deterministic. Contextual term choices are validated against the catalogue and recorded with source excerpts, but held for human review in this fixture-only release. Media carousel/reel rules are stored; no media renderer is added.

Semantic understanding, cross-language entity normalization, political relevance, fact equivalence, present-tense Arabic style, complete name/claim discovery and the factual entailment of a paraphrase require a language provider. Test responses are hand-labelled fixtures. JSON validation and exact excerpts cannot prove that arbitrary model prose is factually entailed; this release does not claim otherwise. A future live provider needs independent evaluation of omissions, unsupported entities/numbers, quote boundaries and prompt injection before activation.

## Extraction and matching

`contracts.ts` defines strict Zod outputs for understanding, evidence spans, supported actors/action/object/location/time, facts/figures/speakers/claims, semantic comparison and draft assembly. Missing attributes stay null. Original content is immutable. Each post retains platform through Source, external ID, URL, source and ingestion timestamps, language and provider metadata.

`matcher.ts` considers normalized actor identities, action, object, location, explicit event time, source temporal proximity, fact overlap, material facts and provider semantic comparison. Entity overlap alone never means duplicate; exact text is not the matching algorithm. All plausible candidates keep component-level evidence and Arabic rationale.

* NEW_EVENT: create canonical event/revision, then a review or pending draft.
* DUPLICATE: link the source and evidence to the existing revision, no second news item/publication.
* MATERIAL_UPDATE: only provider-identified, verified new figure/decision/outcome/statement creates another revision of that same event. Mere wording/translation does not qualify.
* UNCERTAIN_MATCH: retain candidate matches and draft on SourcePost, hold for review; do not create a speculative event/news item.

Historical and legacy event records remain traceable. A legacy event without the new structured facts prevents silently declaring a fresh event. This is intentionally conservative. Current candidate scanning and a single project transaction lock prioritize correctness for the MVP; a growing archive will need indexed candidate retrieval and evaluated recall before scale.

## Jobs and retries

`ingest` atomically upserts the first post and unique processing job. A cursor advances only after all batch posts commit. Replays preserve original evidence. `claimJob` uses PostgreSQL SKIP LOCKED; opaque claim tokens fence old workers after a five-minute lease expires. Attempts use exponential backoff; invalid schema/evidence is terminal review, transient errors retry. A transaction-scoped advisory lock serializes event creation for this single project and re-reads candidates after locking, so simultaneous translations cannot both create a new event. Provider comparisons/drafting currently run within a bounded 45-second transaction; slow providers require a separate prepare/revalidate design before activation.

Audit stages, rule version, source evidence, matches, errors and retries are inspectable. Worker SIGINT/SIGTERM stops intake and disconnects gracefully. No raw provider exceptions or environment values are logged.

Run `npm run worker` on an existing trusted always-on host or the existing Docker worker service, with environment-only DATABASE_URL. Vercel serves the dashboard; it does not host this permanent worker. No paid host has been provisioned.

## Additive database migration

`202609160001_processing` adds only:

* EventClassification MATERIAL_UPDATE and UNCERTAIN_MATCH; retains old UPDATE/UNCERTAIN values.
* Source.editorialProfile JSON.
* SourcePost.metadata and processingResult JSON.
* A trigger rejecting changes to original content, source identity, source URL/timestamp and ingestion metadata.

No tables/columns/records are dropped or reset. Existing canonical/revision/match/news/publication/jobs/audit models are reused. No production fixtures or invented source classifications are seeded. Keep old application code compatible by leaving these additions in place if rolling back; do not reverse production data destructively.

## Dashboard

Existing authenticated Arabic RTL pages are extended. `/events?kind=DUPLICATE`, `MATERIAL_UPDATE`, or `UNCERTAIN_MATCH` lists related events and explanations. `/posts/[id]` shows extraction, draft, review codes, matching evidence, rule version and audit history, including unresolved posts with no new canonical event. `/review` includes these unresolved posts as well as pending news items. Sources supports audited editorial verification/classification. External send controls are absent.

## Integration/cost boundaries

Checked 2026-09-16:

* X's official [usage/billing documentation](https://docs.x.com/x-api/fundamentals/post-cap) describes pay-per-usage credits. No X API access was purchased or activated; no scraping is implemented. Use fixtures or operator-supplied material obtained through authorized means until access is explicitly approved.
* The [Telegram Bot API](https://core.telegram.org/bots/api) supports channel-post updates for chats accessible to the bot; it does not imply access to arbitrary monitored channels. Authorized channel access or an appropriately authorized client integration must be established first. This release contains fixture monitoring only.
* AI is vendor-neutral and fixture-only. No paid model API is called. A local model could implement the same contract after evaluation; none is installed or silently downloaded.
* Existing Neon and Vercel Hobby configuration is preserved. No new paid service is enabled.

## Test fixture map

| Requested case | Test coverage/provenance |
|---|---|
| Two Telegram sources, Telegram+X, Arabic/English/Persian, rewritten headlines | Hand-labelled visit fixtures; matcher and concurrent database suite; P2.2 p3 |
| Material update / same actors different event / uncertain match | Verified agreement, different city, missing city fixtures; user event semantics |
| Platform retry | Unique ingest/job replay, first original retained; database suite |
| Literal protected term | Quote/official-name/document/hashtag fixtures; R II p11; P5 p5 |
| Serious attributed claim | Nuclear claim literal quote; R II, P4.5, P13.2 |
| Uncovered term | Explicit code/detail, database review state; R IX.6; P4.6 |
| Non-political | European football fixture filtered before event; P2.2/P13.2 |
| Sensitive figures | Single unofficial source figure held; P4.2 |
| 24-hour repeat | Inclusive boundary and outside-window review; P2.2 |
| Publication retry | Concurrent unique intent and attempt constraints, UNKNOWN retained; no engine send |
| Name/term examples | Pezeshkian/Chabahar and institution-vs-geography; P13.2 |
| Failure modes | Invalid schema/evidence, unsupported sentences, quote mutation, ambiguous candidates, stale lease, transient retry, unavailable provider |

Tests require explicit TEST_DATABASE_URL pointing to localhost; never set it to Neon production. Existing HTTP tests require TEST_BASE_URL pointing to the local built server. Run lint, typecheck, db:validate, all tests, and build before committing/deploying.

## Recommended Phase 3 (not started)

Resolve the documented editorial ambiguities and source roster, evaluate an authorized language provider on expanded adversarial multilingual fixtures, choose authorized monitoring access and an existing worker host, then run a shadow-only pilot under REQUIRE_APPROVAL. Design manual canonical-match resolution and publication reconciliation before enabling any real external send.
