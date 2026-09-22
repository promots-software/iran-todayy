# Production editorial contract

The authoritative user attachment is stored **byte-for-byte** at
`config/editorial/iran-now-contract.txt`. It contains sections 1–40, including the
complete final quality check. This document describes wiring, not replacement rules.

SHA-256: `9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456`.
The loader fails closed if the bytes or ordered section headings change. Git
preserves the artifact's original line endings. Docker copies it explicitly;
Next.js output tracing includes it in server functions.

## Actual generation

- DIRECT Arabic: the combined extraction/publication request receives the entire
  contract. Its existing local or independent factual validation remains required.
- DIRECT non-Arabic: extraction and independent translation review remain separate.
  A final article-generation request now receives the entire contract, original
  source, immutable facts and validated translation receipt.
- NORMAL: existing relevance/extraction/classification/matching precede the same
  final article-generation path. Filtering and delivery policy are unchanged.
- Every Arabic-generating request, generation repair, and publication/translation
  review receives the complete artifact in the system instruction. Pure extraction,
  ID-only classification and comparison do not need writing instructions.
- Final proposals have mandatory fact IDs and full-source coverage. Non-literal
  final wording still needs independent factual review; same-call self-attestation
  never establishes grounding. Failed proposals remain available for human review
  with `validated:false`.
- The final receipt records the contract hash. Legacy PDF substitutions cannot
  overwrite contract-governed copy. Historical receipts remain readable, and
  existing frozen publications are not rewritten.

The exact required brand prefix is normalized once between structured storage and
final display. Terminology quotation typography is distinct from literal reported
speech and requires the underlying grounded word. Translated dates/quotes must
match independently validated translation receipts, not a new model assertion.

## Operational impact and verification limits

The former local-assembly path did not generate a final article under a complete
writing contract. It now needs a generation request, plus independent review when
the wording cannot be established locally. Existing request/output limits, cost
guards, retry checkpoints, filtering, source settings and publishing policy remain
unchanged. Oversized or incomplete responses fail closed; no prompt is truncated.

Offline tests inspect the actual native Gemini wire payload after compaction and
compare its embedded artifact hash. They test both processing modes and Arabic,
Persian and English inputs, repair, immutable facts, prefix handling and receipt
validation. Fixture replay is not evidence of live model writing quality. No live
provider call or publication is needed to verify this wiring.
