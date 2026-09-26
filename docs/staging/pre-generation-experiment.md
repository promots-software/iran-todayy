# Staging generation-first experiment — offline gate

## Scope and status

Local branch `codex/staging-v44`, unchanged HEAD `d3a22546b32b104d18d1ecd1736bf725f9dbb529`. Existing bookkeeping hardening retained. No commit, push, deployment, processing resume, requeue, provider call or Telegram activity. Production was not accessed. Runtime activation is restricted to the existing `IRAN_TODAY_ENVIRONMENT=staging` worker identity; this selects ordering, never overrides acceptance.

Read-only staging verification: 2026-09-26 00:41:42.562 UTC / 03:41:42.562 Beirut: processingPaused=true; RUNNING jobs=0. No staging settings were changed.

## Old flow

NORMAL: language detection -> extraction/selection schema -> content-type evidence -> exact evidence/occurrence correction -> complete extraction/coverage -> translation/review where needed -> classification -> matching/accepted-only checks -> canonical generation -> fidelity/receipt/V4.4 -> bounded article repairs -> persistence/delivery policy.

DIRECT: combined extraction/intake/article response -> combined schema and mechanical decoding -> evidence correction/validation -> selection -> article validation -> independent review/V4.4 -> matching -> delivery policy. A generated article could exist in a response but invalid extraction prevented the response from being accepted. Exact same-source dedup could terminate before generation.

## New staging flow

1. Deterministic usable text: textual letters/numbers; no OCR. Empty, emoji-only or replacement-character-only input stops. A stray damaged character does not discard otherwise usable text.
2. Separate semantic Iran intake receives source text only. No source profile/channel authorization shortcut, extraction, offsets, fact IDs, coverage or receipt requirement. A negative decision returns FILTERED / UNRELATED_TO_IRAN for either mode.
3. Positive intake immediately enters canonical V0 generation from the complete frozen processing source under the exact full 40-section contract. The response contains only article title/body and non-blocking diagnostics.
4. Only after V0 exists run source extraction and the retained exact evidence, metadata correction, coverage, classification/translation and semantic validation contracts.
5. DIRECT extraction no longer generates/echoes V0. The application attaches the frozen article. NORMAL binds its frozen text to validated fact references; literal text schemas and local equality checks forbid rewriting during binding.
6. Existing independent fidelity and V4.4 checks, grounded R1/R2 and full revalidation remain mandatory. R1/R2 are the only article modifications after V0. No R3; technical receipts do not authorize article repair.
7. NORMAL validation now precedes event matching. Matching, transaction snapshot rechecks, locks, idempotency and publisher safety are unchanged. DIRECT exact-duplicate short circuit is now after the generation boundary.

Infrastructure/admission/lease/provider/input-size/transport failures retain their actual codes and existing retry policy. Generation is mandatory after positive intake, not a promise that an unavailable provider can return an article. There is no schema/evidence validation between positive intake and the generation call.

PRE_GENERATION audit records usableSourceContent, iranRelated (null until assessed), generationRequired, generationReached and articleReturned. Failure to obtain the required article records IRAN_RELATED_STORY_DID_NOT_REACH_GENERATION as an application diagnostic alongside the actual infrastructure/response cause. Missing required generation input also throws this invariant code. Raw requests/results continue through existing durable HTTP checkpoints.

## Reordered blockers

SOURCE_LANGUAGE_UNCERTAIN; extraction schema/mechanical catalog binding; content-type evidence; INVALID_EVIDENCE; evidence occurrence/offset/context validation; EVIDENCE_METADATA_RANGE_INVALID; complete extraction; DIRECT_MATERIAL_COVERAGE_FAILED; nonexistent fact IDs; missing coverage; translation receipts; classification; independent-review/component/publication-unit accounting; semantic certification; matching/dedup. These checks have not been marked PASS or disabled: they now encounter an already generated V0.

## Frozen boundary replay

This is offline source-text adjudication plus executable boundary replay, not a new model relevance result or fabricated successful completion. Existing 13-response replay also still fails at the recorded downstream defects. Existing generated articles remain untrusted. No unavailable historical article is invented.

| Source/post | Old terminal | Iran related | Usable | Old pre-generation stop | New pre-generation result | Generation mandatory | Historical article missing |
|---|---|---|---|---|---|---|---|
| Khabarfouri 566113 | INVALID_EVIDENCE | Yes | Yes | No | Generate, then validate | Yes | No |
| Mayadeen 80180 | INVALID_EVIDENCE | No | Yes | Yes | FILTERED / UNRELATED_TO_IRAN | No | Yes |
| IraninArabic 119464 | AI_INVALID_SCHEMA | Yes | Yes | No | Generate, then validate | Yes | No |
| Mayadeen 80181 | REVIEW_RECEIPT_INVALID | Yes | Yes | No | Generate, then validate | Yes | No |
| Mayadeen 80182 | INVALID_EVIDENCE | No | Yes | Yes | FILTERED / UNRELATED_TO_IRAN | No | Yes |
| TEST 74 | REVIEW_RECEIPT_INVALID | Yes | Yes | No | Generate, then validate | Yes | No |
| TEST 75 | DIRECT_MATERIAL_COVERAGE_FAILED | Yes | Yes | Yes | PRE-GENERATION BLOCK REMOVED — GENERATION REQUIRED ON NEXT LIVE RUN | Yes | Yes |
| TEST 76 | EVIDENCE_METADATA_RANGE_INVALID | Yes | Yes | Yes | PRE-GENERATION BLOCK REMOVED — GENERATION REQUIRED ON NEXT LIVE RUN | Yes | Yes |
| TEST 77 | REVIEW_RECEIPT_INVALID | Yes | Yes | No | Generate, then validate | Yes | No |
| TEST 78 | DIRECT_MATERIAL_COVERAGE_FAILED | Yes | Yes | Yes | PRE-GENERATION BLOCK REMOVED — GENERATION REQUIRED ON NEXT LIVE RUN | Yes | Yes |
| IRNA 19796 | REVIEW_RECEIPT_INVALID | Yes | Yes | No | Generate, then validate | Yes | No |
| IraninArabic 119465 | AI_INVALID_SCHEMA | Yes | Yes | No | Generate, then validate | Yes | No |
| IraninArabic 119466 | SOURCE_TEXT_REQUIRED | Not established without text | No | Yes | SOURCE_TEXT_REQUIRED | No | Yes |

10 usable Iran-related cases require generation; 3 previously lacked any generated article. Two unrelated and one captionless item do not require generation. A future model's relevance accuracy and actual successful generation are unmeasured; offline labels do not prove live model reliability.

## Safety and verification

- New focused suite: 51 passed, 0 failed, 0 skipped. Both provider modes; corrupted extraction/excerpt/offset/fact IDs/coverage; preserved canonical prompt; exact frozen text; infrastructure audit; real engine audit with local PostgreSQL; faithful mocked independent pass; unsupported/temporal/attribution fail or precise R1; eight-request durable continuation; new engine dedup regression.
- Retained regression suites: bookkeeping 65; frozen historical replay 13; NORMAL v2 38; NORMAL live patterns 12; DIRECT two-stage 24; DIRECT processing 9; V4.4 integration 16; V4.4 production contract 19; targeted repair 27; receipt repair 28; automatic publication contract 59. All passed, no skipped tests.
- Total distinct focused cases: 361 across 12 files, 0 failures, 0 skips. Initial two new local DB fixture failures (invalid uppercase/hyphen handles) were corrected; final 51/51 includes both database cases.
- Dedup proof: two generated same-event posts -> one NewsItem, second DUPLICATE, zero Publication/PublicationAttempt. Existing 59 automatic-publication tests retain mocked exactly-once behavior. No real delivery.
- Semantic tests are controlled receipts/oracles, not proof that a live model always judges correctly. No semantic safety threshold was relaxed.
- No schema/migration changes; Prisma generation/validation not required for this patch.
- Full final build/typecheck/lint and final diff/secret checks are logged under ignored `.test-tools/pre-generation-*` artifacts.

Canonical 40/40 unchanged, SHA256:
`9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456`

## Files changed in this task

- src/lib/processing/pre-generation.ts (new)
- src/lib/processing/contracts.ts
- src/lib/processing/engine.ts
- src/lib/processing/gemini.ts
- src/lib/processing/groq.ts
- src/lib/processing/bookkeeping-contract.ts (retained prior local adapter; extraction-only decode support)
- src/worker/checkpoints.ts
- src/worker/production.ts
- tests/pre-generation.test.ts (new)
- docs/staging/pre-generation-experiment.md (this report)

Previous local hardening files and fixtures remain intact; they are not silently included as new work.

## Cost/latency and recommendation

This focused ordering experiment adds separate intake and V0 generation while retaining downstream contracts. Baseline without comparisons/corrections: DIRECT 8 requests, NORMAL Arabic 10, NORMAL non-Arabic 12. Normal reaches the unchanged 8-new-request attempt ceiling and uses existing durable continuation/checkpoint replay; verified offline. No budgets, output ceilings, concurrency, retry counts or provider configuration were raised. Reducing these calls is outside this task.

Offline gate supports a separately authorized, bounded fresh staging canary after deployment of this local patch. Do not resume the currently deployed old worker expecting this ordering. Do not resume unbounded processing: real relevance accuracy, provider schema compatibility, cost and latency for these new request shapes remain unmeasured. Processing remains paused. No deployment or resume is authorized/performed by this report.
