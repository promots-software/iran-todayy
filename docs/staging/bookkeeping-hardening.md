# Staging bookkeeping hardening — bounded offline pass

Branch: codex/staging-v44. No commit, push, deploy, provider call, requeue or send.
Staging processing remains paused. This change does not resume it.

## Implemented boundary

The canonical internal extraction, fidelity, repair, proposition, delivery and publication contracts are retained. A wire adapter offers source atoms bound to exact text and namespace by hash. The model selects a first/last atom and source context units; the application resolves one contiguous original substring and UTF-16 coordinates. It does not concatenate separated spans, normalize spelling, select synonyms, infer speakers or certify semantic support.

Extraction statements explicitly select the source units they cover. Local code assigns f1..fn and inverts those selections into coverage. Unknown, missing, duplicate and conflicting selections fail. This removes the need to generate references to nonexistent f5/f3. It does not guess the correct associations in old invalid outputs.

Review results, coverage and candidate component groups are keyed by known immutable source/publication units. Local code derives IDs, parent excerpts, parent verdict aggregates, source-link unions and receipt arrays. Temporal and component evidence selects source/candidate atoms independently. Existing fidelity and V4.4 validators still run. Negative semantic verdicts are never replaced by prose explanations.

Metadata correction selects an immutable allowed occurrence ID or UNRESOLVED; local code dereferences the already-frozen candidate range. It cannot round offsets, substitute an occurrence or recover missing evidence.

Raw JSON duplicate keys are rejected, including escaped-equivalent keys. Invalid new-format responses cannot fall back to legacy validation. Old canonical-format checkpoints remain subject to their unchanged strict schemas and validators, rather than being rewritten into guessed new selections.

One deterministic validator inconsistency was corrected: the existing canonical publication-prefix exemption also applies inside component accounting, only at the actual beginning of the publication. Interior content and all material words remain accounted for.

## Whole processing-path schema inventory

| Stage | Mechanical boundary / decision |
|---|---|
| Source normalization / media gate | Unchanged raw provenance, normalized coordinates, empty caption remains SOURCE_TEXT_REQUIRED. No OCR. |
| NORMAL extraction / DIRECT combined | New immutable atom/context selections; local fact IDs and coverage inversion. Existing schema bounds, speaker unions, semantic selection and safety labels remain. |
| Evidence metadata correction | New keyed occurrence selection; existing candidate whitelist, immutable extraction and full revalidation remain. |
| Classification | Already uses enums generated from validated extraction references and exact local fact/anchor validation. Semantic labels and rationale-ID choices remain provider decisions. No change to topical policy. |
| Persian rendering / independent rendering review | Existing request-bound reference-ID enums, local exact ID-set checks, Arabic-only, numeric/quote and independent semantic checks retained. Array duplicate/missing checks remain strict; not permissively deduplicated. |
| Draft | Existing groundedPublicationSchema uses validated fact IDs. Article writing is semantic. Existing numeric/date/quote/coverage checks retained. |
| DIRECT independent / NORMAL publication review | New keyed review/coverage/claim wire representation. Component IDs, claim text and verdict aggregation are local. Exact evidence, complete accounting and structured temporal checks remain. |
| Matching / event identity | Existing immutable candidate/fact references and semantic comparison remain; no inferred associations or dedup changes. |
| V4.4 source/candidate inventories | Existing exact unit/evidence validation, local uniqueness/topology checks retained. Proposition identification and relation topology remain semantic; this pass does not replace the separately tested V4.4 inventory architecture. |
| V4.4 assessor / comparator | Immutable typed supportId catalog, deterministic dereference, blindness, reconciliation and negative findings unchanged. |
| R1/R2 | Same maximum two diagnosed article repairs, full revalidation, protected findings and no R3. Mechanical failures never grant article authority. New mocked integration proves a valid keyed temporal negative reaches R1, while clean output reaches the mandatory V4.4 stage. |
| Publication / retry / checkpoints | No eligibility, policy, dedup, transport, source authorization or request-count changes. New wire payload creates a different request identity; this is not permission to requeue historical failures. |

Required fields stay required. Nullable anchors/speakers retain their canonical semantics, including DIRECT speaker/kind unions. Unknown IDs and extra fields fail. Wire array min/max omission remains the existing Gemini compatibility projection; local min/max and complete-ID validation remain authoritative. Truncation/non-STOP/invalid JSON remain terminal. No token ceiling, budget, concurrency or retry limit was increased.

## Error precedence and recovery

1. Transport/JSON/schema/catalog failures: no article authority.
2. Invalid receipt: bounded receipt correction only, with protected negative findings.
3. Structurally valid semantic defect: existing grounded R1, full validation, justified R2, full validation, STOP; no R3.
4. Genuine source insufficiency or policy filtering: unchanged.

Source units and token IDs establish exact binding, not real-world truth or semantic equivalence. An existing but unrelated selected span is not endorsed by the adapter. The semantic review and V4.4 gates must still reject it. This pass does not claim to independently detect a model that lies consistently in all structured semantic fields.

## Frozen replay: all 13 original responses, no substitutions

| Source/post | Old terminal | New frozen-artifact terminal |
|---|---|---|
| khabarfouri/566113 | INVALID_EVIDENCE | Same: nonexistent تکذیب excerpt |
| mayadeenchannel/80180 | INVALID_EVIDENCE | Same: changed hashtag spelling |
| iraninarabic/119464 | AI_INVALID_SCHEMA | Same: duplicate corrected review entries |
| mayadeenchannel/80181 | REVIEW_RECEIPT_INVALID | Same: incomplete component accounting after receipt correction |
| mayadeenchannel/80182 | INVALID_EVIDENCE | Same: changed hashtag spelling |
| TEST/74 | REVIEW_RECEIPT_INVALID | Same: invented ellipsis in temporal candidate excerpt |
| TEST/75 | DIRECT_MATERIAL_COVERAGE_FAILED | Same: nonexistent f5 |
| TEST/76 | EVIDENCE_METADATA_RANGE_INVALID | Same: selected [89,93) is not a permitted exact occurrence |
| TEST/77 | REVIEW_RECEIPT_INVALID | Same: incomplete component accounting |
| TEST/78 | DIRECT_MATERIAL_COVERAGE_FAILED | Same: nonexistent f3 |
| irna_ar/19796 | REVIEW_RECEIPT_INVALID | Same: invented ellipsis in temporal source excerpt |
| iraninarabic/119465 | AI_INVALID_SCHEMA | Same: duplicate review entry; underlying planned-to-completed defect remains |
| iraninarabic/119466 | SOURCE_TEXT_REQUIRED | Same: empty media-only source |

No historical record is declared READY or TECHNICAL BLOCK REMOVED. The new contract prevents several mechanics from needing to be generated in future responses; it cannot manufacture those new selections from invalid historical output. Tests for the new representation are distinct synthetic/offline tests, not altered frozen replay expectations.

## Verification and limits

- Frozen fixture includes all 13 staging failed/review items and their exact stored structured provider output. Provider signatures and credentials excluded.
- Existing focused regressions: 406 passing across 20 files, including DIRECT/NORMAL, fidelity, R1/R2, V4.4 and automatic publishing.
- New adapter/matrix: 65 passing; frozen replay: 13 passing. Distinct total: 484 pass / 0 fail / 0 skip across 22 files.
- No claim that all repository tests were rerun or that the separately accepted 18 baseline failures disappeared.
- Local production build passed. Typecheck is run after build so generated Next types are stable. Scoped lint and diff/secret review are separately recorded in local verification logs.
- Prisma schema/migrations unchanged; no database migration or generation needed for this patch.
- Canonical SHA256: 9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456, byte-for-byte 40/40 unchanged.

## Remaining risks / recommendation

Provider compliance with the new keyed/span-selection schemas has not been measured live. More ID selections may affect prompt/response size and latency; the existing input/4096-output limits still fail closed. Incomplete component coverage, wrong semantic selections, inadequate source inventories, unsupported additions and malformed responses remain possible and must block. Existing invalid historical payloads are not repairable without new semantic work.

One separately authorized, cost-bounded fresh staging canary is justified after review and a separate staging deployment decision, not an unbounded resume and not a historical replay. Keep processing paused now. No production deployment recommendation is made.
