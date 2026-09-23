# DIRECT routing audit — 2026-09-23

Baseline: `84bcdc611e4eb55a66d23ce007c99b5b50e8bf8d`.

This is a code-path audit, not a production mutation or proof of a deployed change.

| Boundary | Current behavior | Classification |
|---|---|---|
| `direct-policy.ts` | DIRECT bypasses relevance/selection rejection | Already correct |
| `groq.ts` → `direct.ts` | Exact extraction, speaker validation and completeness may throw before final copy exists | Evidence used for both editorial decisions and matching |
| `direct-bilingual.ts` | Independent translation/coverage receipt is mandatory; incomplete coverage throws | Factual/editorial diagnostic currently blocking |
| `direct-publication.ts` | Coverage, numbers, entity/quote/attribution checks and independent review block acceptance of a publication proposal | Factual/editorial diagnostic currently blocking |
| `engine.ts` before matching | `assertDirectFullCoverage` repeats the receipt gate | Editorial gate |
| `matcher.ts` | Ambiguous matches prevent new publication; material updates require source-grounded evidence, not independent real-world truth verification | Deduplication safety, must remain |
| `engine.ts` draft-skipped branch | Non-duplicate incomplete/uncertain results become `NEEDS_REVIEW` | Mixed editorial and dedup states |
| `local-finalization.ts` / `editorial.ts` | Provenance, attribution, factual and editorial checks produce review reasons or throw | Mixed output integrity and editorial diagnostics |
| `engine.ts` successful transaction | Blocking reasons, media dependency and match conflicts select `NEEDS_REVIEW` instead of `PENDING_APPROVAL` | Mixed editorial and dedup states |
| `engine.ts` exception handler | Terminal nontechnical errors become `NEEDS_REVIEW`; errors retain original context | Editorial routing; technical errors must remain non-publishable |
| `engine.ts` expired claim | Exhausted leases assign `NEEDS_REVIEW` without distinguishing source mode | Technical failure incorrectly represented as editorial review |
| `publication-policy.ts` | Revalidates extraction and DIRECT coverage at readiness and again at send claim | Hidden downstream gate; cannot change only the processor |
| `publisher.ts` freeze | Requires immutable event facts, exact source spans and complete sentence links before freezing | Provenance/integrity contract coupled to editorial validation |
| `human-editorial.ts` | Edited text requires explicit approval | Must remain unchanged |
| `automatic-delivery.ts` / `publisher.ts` | Fresh policy acknowledgement, source authorization, Emergency Stop, frozen content, durable claim and attempts | Must remain unchanged |

## Implementation boundary

The new DIRECT contract needs a distinct generation receipt. It must not relabel
an editorially unchecked article as having passed the old semantic validator.
The receipt must bind the complete original source, canonical contract version,
and exact completed article while retaining diagnostics separately.

Matching must still consume trustworthy source evidence. A missing or corrupted
matching input is not permission to declare a new event, and an uncertain match
must not be disguised as an editorial review or a provider failure.

Old receipts and historical held stories must keep their original semantics.
NORMAL must continue using its existing validation, review and delivery gates.

## Implemented separation

New DIRECT processing uses literal source evidence for matching, then a separate complete-contract article request. The versioned `direct-generation-v2` receipt binds source, matching event, final article and canonical-file hashes. It explicitly records `DIAGNOSTIC_ONLY` semantic verification. Editorial diagnostics do not grant or deny delivery. Historical receipts retain their original checks.

Unresolved matching uses `MATCHING_HOLD` and a failed job, outside the ordinary editorial queue; no article is generated or delivered until uniqueness is established. Provider/parser/empty-output/database failures remain technical. Exhausted leases are FAILED, not editorial review.

The existing publisher rechecks source binding, exact article, completed job/match, current policy and human-edit exclusions. It does not repeat editorial coverage scoring for v2. Material-update event history retains prior evidence while the frozen publication binds only its own current source evidence. NORMAL editorial processing is unchanged.

Baseline DIRECT now uses two requests (literal matching extraction, then final article); plausible-event semantic comparisons can add requests. Existing request/token/cost limits are unchanged. No independent semantic pass is represented as completed.
