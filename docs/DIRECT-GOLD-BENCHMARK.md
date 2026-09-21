# DIRECT Gold Benchmark v1

Engineering-authored, **not yet human-signed-off gold**. This is a test harness,
not an approval or publication service. Passing replay does not qualify a model
or production launch. The production pipeline is not changed by this task.

## Dataset and provenance

`tests/benchmarks/direct-gold-v1.json` contains exactly 50 cases:

| Category | Count |
| --- | ---: |
| A: short Arabic FLASH | 8 |
| B: multifactual Arabic | 8 |
| C: attribution | 6 |
| D: numbers/dates/locations/units | 5 |
| E: protected quotations | 4 |
| F: awkward/colloquial Arabic | 5 |
| G: Persian to Arabic | 5 |
| H: exact duplicate / near duplicate / material update | 3 |
| I: adversarial semantics | 3 |
| J: completeness/modality/causality | 3 |

All 50 are explicitly SYNTHETIC; none claims to be a historical source-to-gold
pair. Unique case IDs include intentionally repeated news for dedup testing.
Cases model the six production failure *structures*, not a claim of historical
paired truth. Historical local `irannow_messages.json` IDs 36165–36167 were read
only for single branding, attribution and separated clauses. Its exported dates
are unreliable and unused; no source texts were invented for those final posts.
The export is not committed. Policy authority remains the repository's existing
PDF-transcribed rules, editorial validators and newsroom format.

Each case has explicit material facts, original evidence excerpts, semantic
predicates/alternatives, mandatory entities/attributions/numbers/dates/places/
quotes/modalities/conditions, forbidden additions, coverage, style constraints,
expected disposition and duplicate/update relationship. Schema validates IDs,
source excerpts, ordering/dependencies and coverage. Replay fields are **mock
provider inputs**, never measured Gemini output or human attestations.

## Default execution

From the benchmark checkout:

```powershell
npm run benchmark:direct
```

No dotenv loading, provider network, Telegram client, production database client,
approval, queue or publication service is invoked. Output goes to ignored
`.test-tools/benchmarks/direct-gold-v1-replay.json`. Exit 1 means the quality gate
found failures, not that the harness crashed. Per-case output and aggregate
semantic/quality/technical/unverified counts stay separate. Mock stage counts
are separate from actual network counts; mock tokens and cost are zero.

The runner exercises the real Gemini adapter with a substituted transport,
DIRECT extraction/evidence/completeness, independent-review receipt validation,
matcher, deterministic final rendering/editorial checks and editorial decision.
It uses an in-memory event list with the same strict matcher; exact originals
skip extraction. It intentionally does not emulate production DB transactions,
leases or publication execution. Existing DB-backed DIRECT regression tests
cover those boundaries separately.

## Evaluator scope

This is a finite semantic specification, not a universal natural-language oracle.
Per-fact predicates allow alternative wording and sentence order without exact
whole-draft equality. Explicit speaker bindings and simple subject/action/object
frames preserve relationships. Evidence text/IDs, complete fact coverage,
sentence mapping, numeric/date/place/entity requirements, verbatim quotation,
negation, modality, conditions and prohibited implications are checked.

Novel semantic wording is UNVERIFIED and cannot pass the gate. This can reject a
valid unfamiliar paraphrase; human evaluation must adjudicate it rather than
silently expand the accepted vocabulary. Known same-word role inversions,
speaker swaps and audience/ownership changes have adversarial tests. This still
does not prove arbitrary paraphrases equivalent. Style probes catch colloquial
copy, attribution-only headlines, gender errors, redundant attribution, duplicate
full copy, branding and added urgency. Human newsroom-quality review is required.

Hard requirement is zero critical semantic failures. UNVERIFIED findings also
block qualification. Never collapse them into a weighted aggregate score.
Withheld drafts are not counted as multiple fabricated omissions; the actual
decision disagreement is reported instead.

## Initial replay findings, before production corrections (no model calls)

46/50 cases pass all checks. Four remain blocked:

- D37/D39: Persian local renderer produces `قال وزارة النقل، في إفادته: أعلنت
  وزارة النقل ...`: gender agreement + repeated attribution + unexplained
  wording `إفادته`.
- D40: Persian local renderer repeats the Council attribution and adds `إفادته`.
- D44: matcher returns UNCERTAIN_MATCH for a material update. The existing
  classifier adapter sets fact `verified=false`; the matcher requires that field
  for a material update even after the fixture's independent SAME/new-fact
  comparison. No draft is generated and no facts are fabricated. This is a
  **safe hold**, but disagrees with the engineering gold expectation and needs
  explicit contract/policy review. This task does not change it.

Counts: 1 critical duplicate/update-decision finding; 6 quality findings;
0 technical failures; 3 unverified semantic findings. Findings can overlap on
one case. 57 simulated requests, including one comparison, zero classification;
all five Persian cases use two simulated requests. Exact duplicate uses zero.
No provider output quality or live fallback rate has been measured.

## Corrected replay gate

The production fixes now pass **50/50** cases: zero critical, quality, technical
or unverified findings. Expected dispositions and gold text requirements were
not changed. This remains fixture evidence, not live-model qualification.

Attribution rendering retains already-attributed reviewed Arabic. If a local
frame is needed, explicit feminine institutional heads receive `قالت`, and no
source medium such as `إفادته` is manufactured. Multi-sentence already-attributed
copy uses its complete sentences rather than a duplicated attribution heading.
Persian still requires the independent translation/grounding receipt.

The legacy fact `verified` field is independent real-world verification, not
source support. It is neither set to true nor trusted as evidence. Matching
receives a separate source/understanding context and revalidates its exact event,
source spans, attribution and Arabic copying/reviewed translation. Only grounded
material facts of allowed kinds, independently matched as SAME with explicit new
fact IDs and all existing anchor/time/conflict safeguards, can form an update.
Grounded facts may remain `verified=false`. Missing/invalid grounding still
holds an update as UNCERTAIN_MATCH, even if a provider asserted `verified=true`.
No schema migration or historical data rewrite is needed. The match evidence
records `sourceGrounded` and `materialBasis` explicitly. Draft checkpoint version
changes only for the corrected local rendering, retaining extraction/review
checkpoints without paid regeneration.

The legacy processing fixture now uses exact per-field spans and clearly Arabic
text instead of a whole-source span for every unrelated field; its update
assertions stay intact. The 50-case gold expectations are untouched.

## Explicit live mode — NOT RUN

Only after separate authorization and human gold review:

1. Use a dedicated benchmark Google project/key; never production credentials.
2. Prepare an isolated local PostgreSQL database named
   `iran_today_benchmark_<suffix>` with the current schema. No automatic migration
   is performed by the runner. No production database is accepted.
3. Supply `BENCHMARK_DATABASE_URL`, `BENCHMARK_GEMINI_KEY`, and
   `BENCHMARK_ISOLATED_PROJECT=CONFIRMED` securely in the local process.
   Production DB/provider/Telegram credentials and deployment markers are refused.
4. Explicit command shape (caps require separate budget approval):

```powershell
npm run benchmark:direct -- --live --confirm-paid --max-calls <approved-cap> --max-cost <approved-USD-cap>
```

Requires all opt-ins, local DB, explicit caps, no production environment. Uses
existing `guardedTransport`, durable checkpoints, cost reservation/settlement,
quota and provider capacity rules in that local database. Existing $1.50/$2
cost policy, 4000 RPM / 4M input TPM / 150K RPD, and 4096 output cap are not raised.
Additional max-cost is at most $2. Reservations survive restarts; ambiguous
stages are never blindly repeated. No automatic retry/sleep loop is added.
Only the exact Gemini generation endpoint can receive network traffic.
Network attempts are counted even on transport failure; incomplete usage is
explicitly unmeasured. Token-priced cost is estimated, not provider-billed cost.

The local ledger cannot know spending by another process/project. Use a genuinely
dedicated project/key and database; the confirmation is an operator assertion,
not Google project identity verification. Conservative byte reservations may
stop a run before all 50 cases. Do not raise production budgets to finish it.
Theoretical baseline is 54 calls after the exact duplicate skip ((45 Arabic cases - 1 duplicate)
+ 5 Persian cases × 2 calls), plus necessary Arabic
reviews and semantic comparisons. Actual fixture total is 57.

## Future 500-case stage — prepared, not executed

`runCases` accepts arbitrary case arrays and an injected provider transport.
`validateDataset(raw, size)` can enforce another versioned corpus size.
`simulation.ts` exposes virtual time, idempotent persistence, scheduling and a
checkpoint store. The existing checkpoint implementation is tested with replay
and ambiguous interrupted intent. Fault transports can inject 429/503/schema/
timeout outcomes without any network.

A future suite must supply the 500 reviewed cases and implement scheduling
scenarios for concurrency, retries, queue order, worker restart, cost exhaustion,
no-loss persistence and candidate/publication uniqueness. Ports are prepared;
the full 500-case simulation and DB/worker recovery qualification are NOT done.
No send implementation exists in this harness.

## Before launch

The four fixture blockers are corrected. Obtain independent bilingual
human gold sign-off; review the finite evaluator's false positives/negatives;
authorize isolated live budget; assess real model outputs and costs; then run
the separately approved resilience simulation. A passing harness alone cannot
authorize launch or Auto Publish.
