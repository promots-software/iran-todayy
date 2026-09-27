# Lossless staging transport verification

Base: 3d4c1778be4a977557d4f3071b62940a3b2f4bfe. Offline only.

Matcher documents preserve full source excerpts, Arabic, speakers and nondefault semantic fields. Only exact derived hash keys, local coordinate/identity metadata, empty fields and exactly repeated summaries are omitted from wire. Full immutable local snapshot remains. Retrieval V1 is unchanged. Snapshot transport version distinguishes new payloads.

Live checker uses contract-bound 40 ordered P/F/N statuses and complete FAIL diagnoses, reconstructed into the existing domain receipt. Missing/extra statuses, invalid mappings, empty failure diagnoses and truncation reject. Legacy row schema/decoder remain for offline experimental callers only; the live adapter has no legacy fallback. R1/R2 full checks and no R3 are preserved.

## Offline evidence

- Retrieval: 255/255 self-replay; 38/38 gold relationships, 35/35 decisions; 13 duplicate, 7 update, 18 uncertainty.
- Matcher: 141/141 valid decisions identical; 114/114 invalid/truncated rejected.
- Candidate semantic-field preservation: 82 historical versions plus nondefault-field control.
- Checker: all 349 stored receipts examined; 346 current-schema receipts reconstruct identically. Three legacy failures lack mandatory quote fields and are rejected, not upgraded by inventing evidence. Only five supported historical receipts contain FAIL. Failure-heavy validation NOT PROVEN.
- Focused suite: 419 pass, 1 database skip. Historical suite: 350 pass. Compatibility/adapter suite: 49 pass.

## Actual serialization and estimated cost

50 clean matcher requests: average 23519.36 -> 20866.12 bytes (-11.2811%).
346 supported checker receipts: average 1926.4133 -> 272.7341 bytes (-85.8424%). Old observed output average 777.0405 tokens; new offline proxy 265.6416, not measured provider usage.
47 clean checker receipts: average 1925.4255 -> 267 bytes; observed old output 794.3191 tokens. Cost uses conservative 344 tokens/check (maximum clean proxy), not mean 266.1277. Failure-heavy output/repair costs remain unverified.

Input estimates use measured historical tokens scaled by actual request bytes with 25% padding, capped at old measured input. Checker input adds measured-byte growth (539 bytes/request) with 25% padding on that increment; tokenization is unmeasured. This is a projection, not a guaranteed ceiling. Matcher output retains conservative 442.65765 tokens/call. Rates $0.25/M input and $1.50/M output; same usability 628/746 and 61-story stage mix. No new token-counting/provider call.

| Incoming/day | Intake | Generation | Checker | Matcher input | Matcher output | Total before repairs |
|---|---:|---:|---:|---:|---:|---:|
|480|0.061908|0.506404|0.655887|0.508312|0.219918|1.952428|
|500|0.064487|0.527504|0.683215|0.529491|0.229082|2.033780|
|550|0.070936|0.580254|0.751537|0.582441|0.251990|2.237158|
|600|0.077385|0.633005|0.819858|0.635390|0.274898|2.440536|

At 500: saving $0.274446/day; $0.033780 ABOVE $2 before repairs. Difference from studied $1.917110959 includes conservative checker output allowance, preserved semantic keys/explicit matcher transport guidance, and the larger checker request. No tuning to force the target.

Canonical 40/40 SHA256: 9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456 unchanged.

Next proposed live gate (NOT authorized/executed here): frozen faithful and multi-defect cases, compact matcher/checker compatibility, exact failure diagnoses and one bounded R1/R2 sequence with complete rechecks. Measure actual tokens and repairs before relying on this cost estimate. No DB/delivery actions needed.

Final relevant suite: 998 tests, 971 passed, 3 acknowledged baseline assertions failed, 24 database tests skipped. No new regression remains. Typecheck/scoped lint/diff check pass.
