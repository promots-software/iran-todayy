# Editorial compliance audit — 40 sections

Authority: [owner's complete guideline](EDITORIAL-GUIDELINES-40.md), including §40 final checklist. Audit baseline b9d2940 and this release. Historical corpus is style evidence, not factual gold. “Compliant” below means a concrete contract/check with offline regression coverage, **not a guarantee of live model quality**. Partial means a subjective judgment, limited fixture coverage, or an explicit safety conflict. No live model calls were used.

Implementation references under `src/lib/processing/`: S = `iran-now-style.ts`; E = `editorial.ts`; G = `guideline-checks.ts`; P = `direct-publication.ts`; B = `direct-bilingual.ts`; A = `attribution-rendering.ts`; C = `constrained-rewrite.ts`; R = `rules.ts`; M = `newsroom-format.ts`. Transport T = `src/lib/telegram/format.ts`. Test references are files under `tests/` (Gold cases are in `benchmarks/direct-gold-v1.json`).

| § / requirement | Stage and actual implementation | Prompt | Deterministic / validator | Regression evidence | Status / remediation or limitation |
|---|---|---|---|---|---|
| 1 Understand, central event, professional rewrite | DIRECT generation S/P/B; NORMAL immutable extraction/C | S | Exact evidence, full coverage P/B; independent review for novel wording | direct-newsroom; Gold D01–16 | Partial: natural style/central-event judgment is not provable by substring validation; retain human review |
| 2 Required opening | E/M canonical legacy prefix, T presentation prefix | S prohibits model branding | T strips duplicate leading branding and escapes HTML | telegram-format; direct-style | Compliant: exactly one displayed prefix; canonical text never contains transport markup |
| 3 Israel typography | E outside protected spans | R/S | Exact word quoted outside protected text | direct-newsroom; processing | Partial: broader inflected forms require supported terminology; literal quotes override convention |
| 4 Persian months | M/B/E | S preserves calendar identity | Month/calendar validation; unsafe date changes fail closed | editorial-guidelines; direct-newsroom | Partial: owner's same-day Gregorian examples conflict with factual dates; no fabricated conversion |
| 5 Headline | P/C/S | Informative concise headline; no new identity | Mandatory title provenance, exact fact IDs | direct-newsroom; Gold D01–16 | Partial: newsworthiness is human judgment; no arbitrary length truncation |
| 6 Body structure | P/S | Short distinct paragraphs; no padding | Full coverage; FLASH empty body; repeated exact content suppressed at transport | flash-publication; telegram-format; Gold D12/16 | Partial: 2–4 paragraphs are guidance, not factual eligibility gate |
| 7 Natural translation | B/S, NORMAL evidence-rendering | Reconstruct Arabic, not source syntax | Independent semantic review, receipts, entity/number/negation checks | direct-bilingual; Gold D37–41 | Partial: mock receipts test enforcement, not live fluency |
| 8 Light fusha | S/E | Explicit Modern Standard Arabic | Language check and conservative spelling catalogue | direct-newsroom awkward fixture; Gold D32–36 | Partial: no blanket colloquial-word blacklist; quoted speech preserved |
| 9 Editorial framing | S/R/A | Supported Iranian position, no invented framing | Attribution/provenance review; no unsupported context | Gold D21/45–49 | Partial: framing quality needs human evaluation; claim ownership wins |
| 10 Attribution | A/B/P/C | Speaker and claim ownership required | Speaker evidence and grammatical lead, no duplicated attribution | direct-grounding-fixes; Gold D17–22/37/39/40 | Compliant |
| 11 Foreign claims | S/R/A | Allegations remain attributed | Serious-claim title/body attribution and semantic review | Gold D21/22/47 | Compliant for claim fidelity; nationality itself never licenses changed wording |
| 12 Strong pro-Iran framing | S | No invented escalation, motives, pressure or illegality | Evidence/semantic validation retained | Gold D45–49 | Partial: guideline example expands persons to companies; forbidden without evidence |
| 13 Military news | S/R/A | Military claims retain source/uncertainty | Speaker and modality checks | direct-newsroom; Gold D21/22 | Partial: institution expansions only if grounded; broad military domain quality not live measured |
| 14 Quotes | E/B/P/C | Literal byte preservation; translations not literal quotes | Exact span/substring; no rewriting protected text | Gold D28–31; processing; direct-newsroom | Compliant; safety overrides “paraphrase most” if qualification could be lost |
| 15 Names | R/E/B | Established name only when identity grounded | Supported alias catalogue, immutable evidence, unresolved term review | processing; direct-bilingual; Gold D45 | Partial: not an exhaustive current-office registry; no invented office verification |
| 16 Institutions | R/A/B | Established Arabic equivalent only for identified entity | Generic institution cannot become identified entity | direct-grounding-fixes; processing; id-classification tests | Compliant within reference/grounding contract |
| 17 Numbers | P/B/E | Exact numbers, units; no rounding | Numeric integrity and independent translation checks | Gold D23–27/38; direct-bilingual | Compliant |
| 18 Dates | M/B/E | Keep calendar, no invented Gregorian date | Calendar/number checks fail closed | editorial-guidelines; direct-newsroom | Partial: automatic complete Jalali conversion not implemented; uncertain conversion held |
| 19 Locations | R/P/B | Established name, no semantic translation | Evidence/reference/entity consistency | direct-newsroom mutation tests; Gold D23 | Compliant within supported identity contract |
| 20 Social length | S/P | Concise, no automatic emoji/hashtags, no padding | G findings; full facts retained; response limits fail closed | editorial-guidelines; flash-publication | Partial: concision never authorizes loss of material facts |
| 21 Breaking | S/G | No automatic عاجل even from source | New anchored urgent-label review check | editorial-guidelines | Compliant: no automated urgent override introduced |
| 22 Video | S/M; publication-media | Only described scenes | Source-media review; separate publication image | dashboard-media-processing; direct-newsroom | Partial: no vision verification; editor must inspect visual evidence |
| 23 نورویدئو | S/B | Supported new-video label | Arabic language / receipt checks | direct-bilingual language checks | Partial: dedicated natural-video translation case not in unchanged Gold; no unattended visual claims |
| 24 Media source references | R/B/A | Preserve exact media identity/attribution | Supported speaker/source references | direct-grounding-fixes; direct-newsroom | Compliant within references; not a licence to infer channel ownership |
| 25 Arabic rewriting | P/S | Polish genuine awkwardness, clean FLASH exception | Local safe edits or independent review of broader paraphrase | direct-newsroom; Gold D32–36 | Partial: one-call baseline is not unlimited semantic rewriting |
| 26 English | B/S | Reconstruct naturally, never invent says/announces | Independent equivalence/full-source coverage | direct-bilingual English fixtures | Partial: supplied example adds a speech act; rejected unless grounded |
| 27 Persian | B/S/A | Natural Arabic, institution agreement | Independent review, no invented source medium | direct-grounding-fixes; Gold D37–41 | Compliant for tested safety/grammar structures; live fluency remains unmeasured |
| 28 Political statements | A/P/B | Preserve meaning, no added defiance/motive | Negation/modality/attribution checks | Gold D21/28/39/45–49 | Compliant |
| 29 Security/terrorism | R/S | Attributed source designation only | Exact terminology choices and claim-owner checks | processing; direct-newsroom mutation tests | Partial: no unsupported relabeling; broad domain judgment not fully represented in Gold |
| 30 Humanitarian/legal | S/P/B | Preserve allegation/finding/judgment distinction | Independent equivalence, modality checks | Gold D21/22/47; editorial-guidelines guidance | Partial: legal-domain semantic breadth not proven by mocks alone |
| 31 Economy | S/R/P/B | Exact financial units/authority, no predictions | Units/numeric and unsupported-addition checks | Gold D24–26; direct-newsroom | Compliant for protected facts; financial style guided |
| 32 Sports | S; DIRECT policy | Result/competition/team only when present | No fabricated required fields; DIRECT skips editorial topic filter | direct-style; direct-processing | Partial: NORMAL selection remains unchanged; sports prose quality not live evaluated |
| 33 Repetition | S/P/M/T | Avoid repeated headline/body | Exact normalized duplicates suppressed; no fabricated body | flash-publication; telegram-format; Gold D35 | Partial: semantic repetition differs from exact duplication and remains style review |
| 34 No added context | P/B/C | Explicit no inference | Evidence IDs, full coverage, semantic independent review | Gold D45–50; direct-newsroom corruption | Compliant |
| 35 Strong claims | S/A/P | Preserve wording scope/claim ownership | Serious attribution, no unsupported weakening or intensifying | Gold D21/22/47 | Compliant; suggested paraphrase cannot broaden factual scope |
| 36 Editorial intelligence | S | Professional, restrained, evidence first | Unsupported adjectives/context not locally accepted | direct-newsroom unsupported additions | Partial: political awareness/quality are subjective, not self-attestable |
| 37 Rewrite request | S/P | Copy only, no explanation, no invented escalation | Structured schema separates output from system instructions | direct-newsroom; direct-bilingual invalid schema | Compliant for this source-processing product; no user free-prompt channel added |
| 38 Translate request | B/S | Complete material source, scoped by actual input | Full-source coverage and truncation checks | direct-bilingual; Gold D12/41/50 | Compliant; no fabricated context from adjacent stories |
| 39 Output format | E/M/T | Copy only, model no branding/markup | Transport separated/frozen/escaped; title-only FLASH | telegram-format; flash-publication; publication-destination | Compliant; legacy canonical prefix preserved to avoid changing frozen content |
| 40 Final checklist | All above; review UI | Explicit checklist S | Provenance, coverage, attribution, quotes, numbers, dates, G; human draft never validated by prefill | editorial-guidelines; review-draft; Gold/evaluator | Partial: publication-quality naturalness is not certifiable from offline mocks |

## Remediation in this release

- Added specific generation guidance for full-source reconstruction, attribution vs reporting verbs, military/legal distinctions, economic units, sports/video, no invented framing, no automatic urgent label, and calendar fidelity; no new routine model call.
- Added local fail-closed review findings for automatic breaking-news presentation, unrequested emoji/hashtags and transport tags in canonical output. Protected literal quotes are excluded, not rewritten.
- Preserved unvalidated Arabic proposals for human review instead of erasing work when grounding fails. This is not a validation bypass.
- Existing SOURCE mode and grounding contracts remain authoritative. The stricter policy is versioned in DIRECT checkpoint keys; existing historical results are not mutated.

## Explicit conflicts and remaining limitations

1. §4/18 day-preserving month substitution is not a valid Gregorian conversion. Existing calendar-preserving label contract remains; uncertain concrete dates require review. Literal quotes remain immutable.
2. §12 pressure/escalation/company examples, §26 new reporting verbs and §35 broad paraphrases are not allowed unless source evidence establishes them.
3. §14/20 brevity cannot drop material qualifiers/facts; no “most newsworthy only” truncation of material coverage.
4. §3/R terminology never changes protected quotes; contextual terminology still needs validated identity/context.
5. §2/39 branding is a presentation concern. Existing canonical prefix and historical frozen payloads remain valid; transport deduplicates it. Canonical content has no HTML.
6. NORMAL retains its existing conservative local-atom prose and selection policy. DIRECT has guided generation; fluent style cannot be guaranteed by deterministic checks. The unchanged Gold suite is engineered replay evidence, not a live model or human style certification.
7. No new vision, exhaustive name/office registry, automatic Jalali conversion, or conversational rewrite product was introduced. These limitations do not authorize unsupported output.

Final checklist mapping: opening→T; natural Arabic→S + independent review + human review; Israel→E protected transform; Persian dates→M/B; names/numbers→P/B/E; attribution→A/P; invented facts→P/B; repetition→S/T; headline→S/P; framing→S/A; urgent→G; readiness→final validators and manual-review distinctions.
