# Temporal acceptance boundary: offline evidence and escalation requirements

## Scope

Diagnostic/test-only patch. No production behavior, prompts, schema, branding,
thinking level, token ceiling, R1/R2, delivery policy or cost setting changes.

`high-8192-temporal-false-endorsement.json` is a byte-for-byte saved provider
envelope. `temporal-acceptance-boundary.json` preserves the input and expected
UNSUPPORTED judgment, plus exact parsed saved correction receipts.

The scorer reports semanticExpected/Observed/Correct independently of
receiptValid/FailureReason. It reads the model's assertions; it does not infer
Arabic truth. Fixture adjudication supplies truth. Passing a known-gap test
records the vulnerability and must never be reported as semantic safety PASS.

## Demonstrated boundary

The real receipt falsely supports current continuation and fails component
accounting for two reporting frames. The test-only counterfactual adds those
frames only; original components, source links, all verdicts and temporal rows
remain unchanged. The production fidelity validator and acceptPublication then
accept it. This proves a semantic acceptance gap, not an actual publication.

The live replay input had empty facts/coverage. To call acceptPublication, the
integration test explicitly builds verbatim per-source-unit FACT entries,
verified=false, and a complete mapping. This setup is identical before/after
and validated by the production grounding checks. It is offline scaffolding,
not a regenerated or historical extraction. The test does not exercise source
eligibility, matching, final pipeline editorial checks, or Telegram delivery.

The temporal matrix supplies adjudicated states; it proves validator treatment
of those states, NOT the model's ability to infer them. Main-event coverage
cannot replace missing context coverage. The aligned-but-wrong counterfactual
shows that copied contextual state labels still cannot be authenticated locally.

## Existing independently useful data

- Original source, exact occurrence spans, source unit IDs.
- Fact IDs, speaker evidence, candidate/fact mappings when actual extraction exists.
- Separately represented time/phase/continuity/certainty in review receipts.

The last item is produced by the SAME reviewer, so it is not independent proof.
Exact source links authenticate text location, not semantic equivalence.
Current extracted facts do not provide an independently adjudicated per-event
continuity/phase graph with candidate-equivalence proofs. Empty replay facts
make this limitation particularly explicit, but the original text was adequate.

## Escalation design only

A future trigger must consider a proof obligation for EACH candidate proposition:
actor/action/time/phase/continuity/certainty, tied to its own source occurrence
and speaker, separately from main-event propositions. A candidate state qualifier
without independent supporting mapping remains unresolved even when the main
reviewer asserts SUPPORTED/PRESERVED. Missing independent proof must not be
silently inferred from the first review's confidence or matching enums.

This requires new structured independently established source/candidate
propositions, or another independently justified verification mechanism. A
text-difference detector alone cannot distinguish translation/paraphrase from
unsupported continuation. Requiring literal identity would over-block valid
news. Additional model extraction can also be wrong and correlated.

No narrow deterministic invariant currently proves the exact temporal defect
from this coherent receipt alone. Options that escalate only UNCERTAIN,
CHANGED, invalid or inconsistent receipts miss the complete counterfactual.
Do not implement a keyword, morphology or punctuation truth oracle. Do not
claim that a routine second call or stronger wording fixes the problem.

## Separate branding issue

NORMAL draftOnce strips newsroomPrefix before constructing review input while
review instructions include the canonical branding requirement. DIRECT
usableArticle adds it. This remains a separately documented issue; this patch
does not change or test live branding. Neither saved 8192 gap contains branding.

## Required next decision

Authorize design/implementation of an independent proposition-proof boundary
before more live review evaluation. First test trigger coverage of this exact
confident false endorsement, faithful past-progressive and journalistic present,
explicitly supported current continuation, source/candidate role swaps,
missing/uncertain context and multilingual equivalence. Retain full accounting
and constrained receipt preservation. No larger replay is authorized here.
