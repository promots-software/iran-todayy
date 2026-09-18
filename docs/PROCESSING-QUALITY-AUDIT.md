# Production processing audit — 18 September 2026

Read-only baseline: latest 100 terminal attempted jobs across the three enabled Telegram sources, 10:48:57–18:01:29 UTC. Snapshot at 2026-09-18T18:06:37.901Z. No historical records were reprocessed or modified. Sample crosses the earlier Persian rendering deployment; it is not a pure current-version cohort.

## Baseline

- Full validation PASSED: 0/100 (0%).
- Generated Arabic candidates: 15/100 (15%); 14 have no UNSUPPORTED_OUTPUT, QUOTE_REVIEW or CONTEXT_REQUIRED flags, but still have policy/editorial review requirements. This is not independent semantic adjudication.
- FILTERED: 1/100 (1%); confirmed correctly irrelevant: 0. The filtered North Korea nuclear-threat report is political; Iran-specific editorial scope is not established sufficiently to call this a correct filter.
- NEEDS_REVIEW: 99/100 (99%): 83 processing failures, 15 candidates, one uncertain match.
- Stored language: Arabic 50%, Persian 3%, null 47%. Null is missing persistence, not proof of unknown language. Updated local detector on unchanged source text: Arabic 64%, Persian 31%, unknown 5%.

## Exact terminal failures

| Reason | Count / percent |
|---|---:|
| SPEAKER_ATTRIBUTION_MISMATCH | 25 / 25% |
| SOURCE_LANGUAGE_UNCERTAIN | 21 / 21% |
| AMBIGUOUS_EVIDENCE_CONTEXT | 21 / 21% |
| NO_PROCESSING_ERROR | 17 / 17% |
| GROQ_REQUEST_LIMIT | 3 / 3% |
| INCOMPLETE_EXTRACTION | 2 / 2% |
| GEMINI_TRANSPORT_FAILED | 1 / 1% |
| GEMINI_HTTP_503 | 1 / 1% |
| SPEAKER_ATTRIBUTION_REQUIRED | 1 / 1% |
| VALIDATED_ARABIC_RENDERING_REQUIRED | 8 / 8% |

## Source breakdown

| Source | Items | Processing failures | Generated candidates |
|---|---:|---:|---:|
| isna94 | 33 | 32 (97.0%) | 0 |
| irna_ar | 21 | 21 (100.0%) | 0 |
| alalamarabic | 46 | 30 (65.2%) | 15 |

## Exact combinations (codes deduplicated per item)

- 25: SPEAKER_ATTRIBUTION_MISMATCH
- 21: SOURCE_LANGUAGE_UNCERTAIN
- 21: AMBIGUOUS_EVIDENCE_CONTEXT
- 1: CONTEXT_REQUIRED + EDITORIAL_ATTESTATION_REQUIRED + QUOTE_REVIEW + RANK_UNVERIFIED + SERIOUS_CLAIM + SHADOW_MODE_REVIEW + UNCOVERED_TERM + UNKNOWN_NAME + UNVERIFIED_SOURCE
- 3: GROQ_REQUEST_LIMIT
- 1: EDITORIAL_ATTESTATION_REQUIRED + RANK_UNVERIFIED + SERIOUS_CLAIM + SHADOW_MODE_REVIEW + UNCOVERED_TERM + UNVERIFIED_SOURCE
- 2: INCOMPLETE_EXTRACTION
- 4: EDITORIAL_ATTESTATION_REQUIRED + RANK_UNVERIFIED + SHADOW_MODE_REVIEW + UNCOVERED_TERM + UNVERIFIED_SOURCE
- 1: EDITORIAL_ATTESTATION_REQUIRED + LEADER_STATUS + RANK_UNVERIFIED + SERIOUS_CLAIM + SHADOW_MODE_REVIEW + UNCOVERED_TERM + UNKNOWN_NAME + UNVERIFIED_SOURCE
- 1: RANK_UNVERIFIED + UNCERTAIN_MATCH + UNCOVERED_TERM + UNVERIFIED_SOURCE
- 1: EDITORIAL_ATTESTATION_REQUIRED + SENSITIVE_ACTOR + SHADOW_MODE_REVIEW + UNCOVERED_TERM + UNVERIFIED_SOURCE
- 2: EDITORIAL_ATTESTATION_REQUIRED + SENSITIVE_ACTOR + SERIOUS_CLAIM + SHADOW_MODE_REVIEW + UNCOVERED_TERM + UNKNOWN_NAME + UNVERIFIED_SOURCE
- 1: EDITORIAL_ATTESTATION_REQUIRED + SERIOUS_CLAIM + SHADOW_MODE_REVIEW + UNCOVERED_TERM + UNVERIFIED_SOURCE
- 3: EDITORIAL_ATTESTATION_REQUIRED + RANK_UNVERIFIED + SENSITIVE_ACTOR + SERIOUS_CLAIM + SHADOW_MODE_REVIEW + UNCOVERED_TERM + UNKNOWN_NAME + UNVERIFIED_SOURCE
- 1: EDITORIAL_ATTESTATION_REQUIRED + RANK_UNVERIFIED + SENSITIVE_ACTOR + SERIOUS_CLAIM + SHADOW_MODE_REVIEW + SINGLE_UNOFFICIAL_FIGURE + UNCOVERED_TERM + UNKNOWN_NAME + UNVERIFIED_SOURCE
- 1: GEMINI_TRANSPORT_FAILED
- 1: GEMINI_HTTP_503
- 1: SPEAKER_ATTRIBUTION_REQUIRED
- 1: ARCHIVE_ONLY + CONTEXT_REQUIRED + UNVERIFIED_SOURCE
- 8: VALIDATED_ARABIC_RENDERING_REQUIRED

## Representative decisions and limits

- Al Alam 502949 (European Commission fuel-cost statement), 502969 (Arabic nominal headline): false language rejection. Arabic detection demanded two tokens from a short function-word list. Arabic morphology provides additional local evidence. ISNA 404336 contains BRT amid Persian prose; 404347 uses Persian function words omitted from the list. 16/21 historical language failures now detect locally; this is not a claim that all downstream stages pass.
- ISNA 404366 housing-project compensation: explicit deputy-president heading followed by 🔹️ bullets. The validator excluded this role heading and treated the emoji variation selector as prose. Production-structure regression now passes; intervening voices/narratives still fail.
- Al Alam 502970 explicit speaker followed by colon: complete assertion may contain its speaker prefix. Old validator required speaker to precede the assertion, contradicting the complete-assertion extraction contract. Prefix-only regression passes; a person mentioned as claim object fails. Original failed model responses were not stored, so exact historic attribution of these failures is unproven.
- IRNA 19524 repeats the same assertion in headline/body. Unique context remains mandatory. Al Alam 502966 also failed context resolution despite short text; without raw response we cannot distinguish invented whitespace, absent text and repeated excerpts. No normalization or first-occurrence fallback added.
- Eight VALIDATED_ARABIC_RENDERING_REQUIRED failures show extraction-only usage before the Persian rendering deployment. Current rendering receipt/hash, immutable IDs, independent review and number checks remain unchanged.
- Al Alam 502964 produced a candidate but dropped a protected quoted name and has contextual terminology review. This remains a legitimate strict editorial hold, not a clean candidate. Sensitive/serious claims and unknown names remain held.
- INCOMPLETE_EXTRACTION (2), SPEAKER_ATTRIBUTION_REQUIRED (1): no retained failed extraction; provider omission versus context insufficiency unresolved. No invented fallback facts.
- GROQ_REQUEST_LIMIT (3): shared provider per-post eight-call cap includes multiple semantic candidate comparisons. Operational budget limit, not proof of unsupported facts. Not raised or bypassed.
- Gemini transport/503 (2): operational failures, not factual rejections.
- All source editorialProfile values are null. All 15 generated drafts retain human attestation and shadow-mode review. These policy gates are not removed or silently auto-attested.

## Changes and verification

Local language recognition, explicit speaker/heading segmentation, and bounded schema-checked extraction diagnostics only. Diagnostics contain only parsed extraction fields, never transport headers or credentials. Original offsets/source text, strict evidence uniqueness, rendering receipts, manual editorial path and Telegram ingestion are unchanged.

Regression fixtures preserve real source structures with shortened content. Both positive and adversarial variants cover mixed language, speaker changes, ambiguous repetitions, numbers, quotes, unsupported entities and Persian rendering. Offline provider responses are mocks, not evidence of live model reliability.

Baseline recorded provider usage: 165 calls, 400239 tokens, estimated USD 0.16873725. These are historical, not new calls made by this audit. Missing raw stage responses limit root-cause certainty.
