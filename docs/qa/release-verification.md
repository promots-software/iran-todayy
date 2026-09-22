# Deep functional release verification — 2026-09-22

Baseline: `2da22fb08b53060a2596b517b61cdb9d962fd875`. This document records pre-release local results; production verification is reported separately after deployment.

## Executed checks

- Node regressions: **492 tests, 486 passed, 0 failed, 6 skipped**, across 72 files. Latest results after the full run and affected-suite reruns are in `regression-results.json`.
- 341 passes in unit-only suites; 145 in database/mixed suites. Mixed suites also contain unit assertions; these are not 145 exclusively integration tests.
- Overlapping families: 200 semantic-suite passes, 26 state-suite passes, 109 failure/recovery-suite passes. These are not additive categories.
- Playwright: **15 distinct workflows passed**. The full run passed 13; two failed due to test timing/selectors (not application failures) and passed after harness-only corrections. The final two-case rerun exercised image persistence/replacement/removal and canonical SENT inspector/list state.
- Gold fixture replay: **50/50**, zero critical/quality/technical/unverified findings, 57 simulated requests, zero network requests. This is application-contract verification, **not a measured live-model quality result**; harness qualification remains `NOT_LAUNCH_QUALIFIED` because human Gold signoff/live-model evaluation was not performed.
- Clean `npm ci`, typecheck, scoped lint, Prisma validation, production build, whitespace check and task-file secret scan: PASS. Schema/migrations unchanged.
- Six skipped legacy HTTP tests depend on obsolete Basic Auth or separate old fixture credentials. Current browser authentication/direct-access tests replace that functional coverage; the skips remain explicitly recorded.
- Initial restricted-shell runs could not initialize the Windows user lookup used by tsx; reruns with normal local process access passed. Two mistyped test filenames were corrected using repository discovery and the actual suites passed.

## Reproduction and safety evidence

| Defect | Previous failure/root | Fix | Positive and negative evidence |
|---|---|---|---|
| M01 | Repeated literal entity anchor demanded in every sentence | Require anchors in the complete publication; recognize limited institutional orthography in comparison only | Natural institutional wording and continuation pass independent review; wrong country/entity and failed semantic checks reject |
| M02 | Stored model context contains the same city twice | Location-only role proof excludes validated actor spans, requires one remaining explicit locative; layout projection maps back to original bytes | Actual sanitized stored response passes extraction; two locatives, missing actor, no locative, invented city reject; paraphrase still needs independent review |
| M03 | Regional Gregorian month names compared as different dates | Normalize month identity and digit forms, retaining calendar qualifier/day/year | أيلول/سبتمبر accepted; changed day, month, year, number or calendar rejected |
| M04 | Source quote punctuation treated as uncovered content; direct speech with colon failed attribution | Delimiters excluded from lexical coverage; explicit speaker/colon grammar accepted; indirect speech needs independent review | Faithful reported speech passes mocked independent review; changed literal quote and failed semantic/negation checks reject |
| M05 | Actor mandatory even for a complete intransitive event | Complete whole-source, single-assertion event grammar can have no agent | Earthquake, rain, fire and outage fixtures accepted without invented actor; omitted speech attribution rejects |
| M06 | Ambiguous outcome retried indefinitely; exhausted lifetime requests scheduled daily despite an immutable request cap | Terminal technical recovery, no automatic replay, accurate audit/state; ordinary recoverable failures still bounded | DB tests prove terminal state, zero future wait audit, unrelated job claim; existing checkpoint/backoff/restart tests pass |
| M07 | Stale source processing status/eligibility masked durable SENT | Shared presentation resolver gives delivery state precedence | Linked SENT with stale PENDING_APPROVAL shows PUBLISHED in browser; FAILED/human DRAFT cannot inherit stale READY |

Additional repairs: misleading auto-publish-disabled/WEB-only/connector copy; NORMAL/DIRECT source explanation; historical workers presented as current production failures; missing story links for human draft/publication audits. No publication eligibility is granted by the presentation resolver.

## Coverage boundaries and residual risk

See `functional-inventory.json` (18 routes, 15 server actions, 13 enums) and `verification-map.md` for every discovered source/state family and executed transitions. Telegram and X source configuration are covered; no live X connector is activated. Every meaningful family is represented, not every Cartesian product of states, users, and source types.

No real provider/Telegram failure injection, live model benchmark, production approval/requeue, or production data reset was performed. Browser sends use a fake transport and local WEB fixtures. Production delivery continuity must be assessed read-only after release.

Non-literal semantic acceptance remains dependent on the existing independent reviewer; local code does not claim to prove arbitrary paraphrase. Historical failed jobs are preserved and are not automatically reprocessed by this release.

The clean-install audit reports three high-severity dependency entries for the pre-existing `deepmerge-ts` recursion issue in the Prisma tooling chain. npm's suggested remediation is a Prisma downgrade, not a safe task-local update. No exposed untrusted cyclic-object configuration path was identified. The release adds Playwright, not this dependency issue.
