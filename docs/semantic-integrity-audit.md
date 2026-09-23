# Semantic understanding / objective integrity audit

Baseline: `259364fdb7df58f861d1a4dbc9122ac565485ad8`. Completed before implementation.

## Blocking-validator inventory

| Stage / implementation | Objective invariants retained | Semantic heuristics (not independent proof) |
|---|---|---|
| Transport, `groq.ts`, `gemini.ts` | Complete response, JSON/schema, bounded input/output, budget, abort, request accounting | None |
| Extraction, `groq-extraction.ts`, `contracts.ts` | Required structure, nonempty assertions, exact source slices, valid ranges, unique immutable IDs, source-stated event time | Optional missing anchors are not evidence of omission |
| Evidence resolver, `groq-validation.ts` | Exact excerpt, verified offset or unique exact context, no arbitrary occurrence | Location preposition/actor exclusion cannot prove the intended occurrence |
| Speaker, `speaker-evidence.ts` | Both assertion and speaker must be exact source evidence; explicit mapping retained | Role vocabulary, speech verbs, title grammar, commas, bullets, paragraph boundaries and inferred heading scope |
| NORMAL coverage, `normal-v2.ts`, `direct-publication.ts` | Exhaustive source-unit accounting; valid fact references; non-factual rows cannot also claim facts; all extracted facts accounted for | Character masks, mandatory duplicated headlines, outlet/footer lexical coverage, connector vocabulary |
| ID classification, `id-classification.ts` | Exact required IDs, no deletion, no generated factual text, valid topic evidence ID, speaker-bearing kinds require speaker | Geographic keyword vocabulary restricting allowed topics; locally interpreting geography/rationale |
| Legacy classification, `classification-grounding.ts` | Referenced evidence exists | Country/name lexicons, negation grammar, generic-institution translation vocabulary. Not used as a second semantic judge on current ID-only path |
| Translation, `evidence-rendering.ts` | Exact IDs, source-bound receipt, numeric/calendar integrity, complete independent review, no fabricated quote | Country lexicon, identical wording for two renderings of the same span |
| Matching, `matcher.ts` | Known fact IDs, source grounding, temporal window, no duplicate publication | Exact anchor key equality/object/location spelling used as an additional semantic veto after comparison |
| Publication, `direct-publication.ts` | Valid linked fact IDs, all facts represented, unsupported digits/dates/direct quotes, receipt hashes, complete independent review IDs/verdicts | Literal entity spelling retention, colon-ended headline, source-character coverage repeated after extraction |
| DIRECT, `direct-generation.ts` | Complete Arabic article structure, exact source evidence, source/article/event/contract binding, delivery size | Existing catch-all converts even objective publication defects to diagnostics; must distinguish objective defects from semantic diagnostics |
| Final editorial, `editorial.ts`, `local-finalization.ts` | Exact sentence provenance, immutable final receipt, quote/number integrity, supported rule decisions | Legacy speech-verb title test, legacy spelling/terminology/grammar transformations following canonical generation |
| Engine / publisher | Canonical receipt required for live NORMAL/DIRECT, eligibility routing, frozen content, idempotency, acknowledgement, source authorization, emergency stop, human-edit approval | No change authorized or needed |

## Repeated vetoes

Speaker grammar is invoked during extraction, classification preflight, translation/grounding, matching grounding, draft and receipt revalidation. Literal source coverage is invoked during extraction, draft, review acceptance and receipt validation. Entity/attribution semantics are reinterpreted in classification, translation, publication and legacy final editorial checks.

## Replacement contract

Gemini supplies semantic source-unit accounting and explicit speaker/fact associations. Code verifies complete accounting, exact source positions and referential consistency, not whether an unfamiliar construction is Arabic. A repeated headline may reference the same fact; a distribution unit may be non-factual without an outlet allowlist. Missing/uncertain accounting fails closed. A source-unit mapping is a semantic model result, not independent truth verification.

Repair remains bounded to one attempt. Preserve unaffected fields by merging only diagnosed paths; whole-stage schema defects cannot safely use a guessed patch. Revalidate the complete merged candidate. Preserve safe initial and repair diagnostics separately.

Canonical writing remains a separate actual provider stage with the complete unchanged 40-section file. NORMAL retains its existing independent semantic reviews; DIRECT gains no additional call or eligibility gate. Objective final defects block both. Local code cannot prove arbitrary semantic equivalence or discover every hallucination: that remains the semantic generation/review responsibility and must not be represented as deterministic proof.

## Implementation and regression boundaries

- Optional model UTF-16 ranges are untrusted until exact slice/context verification. Unresolved repeated excerpts and invented ellipses still fail.
- Live NORMAL and DIRECT matching requests carry explicit source-unit mappings. Legacy saved receipt utilities retain compatibility; new live requests cannot omit the mapping.
- Speaker text/positions and immutable speaker IDs remain checked. Code does not infer an attribution relation from speech verbs or title dictionaries. A missing speaker for an explicitly classified statement/claim remains invalid.
- Matching retains known-ID, temporal, conflict, multiple-candidate and source-grounded material-update checks. Different anchor spellings are diagnostic; semantic comparison owns equivalence. Existing exact duplicates remain duplicates.
- Repairs preserve independently grounded extraction fields and copy only diagnosed publication fields. The provider retains one repair budget per stage across draft/review revisits. Transport/cost errors retain their original retry classification while preserving the initial validation diagnosis.
- NORMAL semantic rejection and review-protocol failure are distinct: malformed review IDs repair the review, not unrelated factual copy. All final receipts remain bound to the complete canonical contract.
- Legacy fixtures requiring grammar vetoes, implicit location disambiguation, arbitrary whitespace normalization, or retired atom-only transport were updated to the new contract. Their objective failure and independent-review assertions remain covered.
- The ten production fixtures are historical offline evidence, not ten newly accepted stories. Missing semantic attribution in an otherwise literal extraction is not declared correct merely because its spans are valid. NORMAL final review still must establish fidelity; DIRECT has no new independent reviewer.
- No algorithm can deterministically prove all free-form semantic additions/omissions from lexical spans. Production acceptance and writing quality require separately reported observation of new natural traffic.

## Offline release gate

375 focused tests across 33 files passed, zero failures and zero skips. Includes 50 semantic-integrity regressions, all ten stored production structures, NORMAL/DIRECT canonical transport, independent review rejection, material matching, mock automatic/manual delivery, frozen receipts, human edits and publisher control/recovery. No external provider/Telegram transports or production database writes were used by these tests.
