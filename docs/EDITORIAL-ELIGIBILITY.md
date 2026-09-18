# Iran Now editorial eligibility — 2026-09-19

## Scope and confirmed causes

Based on main `be6abf2a4e591e0a7f1945d45a8539e6213d9423`. The worker previously appended SHADOW_MODE_REVIEW to every live draft. Local finalization set three editorial attestations false for every draft. The classifier labelled every non-dictionary actor an uncovered term. Serious claims, ranks, unknown names, small numbers and UNKNOWN topics generated blanket review flags. Title text was repeated in the body; every publication received a hashtag. Terminal technical failures were stored/displayed as unsupported editorial output.

This release changes those policies, not source evidence. Exact substring/context resolution, extraction completeness, immutable IDs, speaker validation, semantic translation review and send fencing remain mandatory. Existing historical rows are never automatically upgraded or replayed into production.

## Eligibility versus delivery

The existing JSON result fields now contain `editorialEligibility` and `deliveryDecision`. No migration is needed. Existing DB statuses continue to enforce approval/publication transitions:

| Editorial state | Existing workflow state | Delivery |
|---|---|---|
| READY_TO_PUBLISH | PENDING_APPROVAL / validation PASSED | HOLD |
| NEEDS_REVIEW | NEEDS_REVIEW | HOLD |
| PROCESSING_ERROR | Existing terminal/retry state, exact error retained | HOLD |
| FILTERED | FILTERED | HOLD |

The worker remains draft-only. AUTO_PUBLISH=false, SHADOW_MODE=true and REQUIRE_APPROVAL=true are not editorial defects. Neither the new eligibility helper nor the UI invokes a publisher. Human overrides always require explicit human approval and manual delivery; they never acquire AI validation.

News feeds, news detail, source detail and review queue show centralized Arabic states: جاهز للنشر، يحتاج مراجعة، خطأ في المعالجة، مرفوض / غير مناسب للنشر. Ready items show a separate delivery-hold explanation. Historical failures retain their original state; technical errors receive a technical display without modifying the row.

## Policy audit

| Family | Current finding / change | Retained blocking condition |
|---|---|---|
| SOURCE_LANGUAGE_UNCERTAIN | Arabic/Persian/English detector already fixed; unchanged | Unknown/mixed source remains blocked |
| SPEAKER_ATTRIBUTION_MISMATCH | Existing bounded heading/continuation scope retained | Unsupported or intervening voice |
| AMBIGUOUS_EVIDENCE_CONTEXT | Unique-context instructions/resolver already fixed; unchanged | Repeated/nonunique excerpt context |
| VALIDATED_ARABIC_RENDERING_REQUIRED | Evidence-ID translation and semantic review already implemented | Missing/failed receipt; English speaker receipts now checked like Persian |
| INCOMPLETE_EXTRACTION | Strict completeness unchanged | Missing required grounded assertions/anchors |
| GROQ_REQUEST_LIMIT | Shared Gemini runner budget; renamed PROVIDER_REQUEST_LIMIT | Eight-call budget unchanged; technical error |
| UNKNOWN_NAME | Dictionary absence alone is not a defect | Identity/link/rendering mismatch |
| RANK_UNVERIFIED | Faithfully copied source rank need not be externally proven | Unsupported title/identity expansion |
| SERIOUS_CLAIM | Properly grounded attributed claim can be ready | Missing speaker, scope or attribution |
| QUOTE_REVIEW | An omitted source quote is not automatically corrupt output; faithful paraphrase is permitted | Fabricated/corrupted output quote, malformed source quote, invalid protected span |
| EDITORIAL_ATTESTATION_REQUIRED | Constrained-copy/validated-translation and configured spelling/term checks can establish scoped attestations | Unresolved fidelity/term check; explicit human override approval remains human-only |
| CONTEXT_REQUIRED | UNKNOWN topic alone no longer blocks a relevant grounded story | Uncertain relevance, incomplete event, contextual terminology ambiguity |
| SHADOW_MODE_REVIEW | Removed from new editorial reasons | Delivery stays held; historical approval records unchanged |
| Numbers | Numeric separators survive punctuation cleanup. Presence of digits is not itself a defect | Changed/invented/misattached quantities remain blocked |

Attestations are evidence-fidelity/configured-check results, not a claim of omniscient spelling knowledge, current-office verification, independent source truth or human approval. Source identity, flagged sources, unresolved name/term ambiguity, conflicting figures/events and uncertain editorial interpretation still need human judgment. Stored human edits, original AI failures, approval invalidation, frozen previews and sent history are unchanged.

## Formatting and dates

- All generated titles receive `إيران الآن |`; no automatic عاجل, emoji or hashtags.
- FLASH: one factual atom, empty body allowed; publisher freezes exactly that title.
- STATEMENT: explicit common speaker heading with contiguous evidence-linked bullets.
- STANDARD_STORY: lead atom plus remaining grounded paragraphs, without repeating the lead.
- MULTI_POINT_REPORT: all material atoms retained in concise separate paragraphs.
- UNCERTAIN_REPORT: existing source uncertainty remains inside unchanged/validated atoms.
- VISUAL: source text must identify video/visual material; no invented visual observations.
- QUOTE_LED: speaker and source literal quotation retained.
- UPDATE: existing material-update matching retained and format recorded as UPDATE; no extra AI generation or altered dedup policy. The renderer remains conservative and can retain contextual atoms from the incoming extraction; sophisticated update compression is not introduced.

Models still select IDs only at final assembly; they cannot write arbitrary publication prose. Foreign-language evidence rendering instructions request natural professional Arabic while the same semantic review checks exact factual scope. Locally recover selection from fact IDs, not sentence splitting, so multiline evidence and repeated text do not lose identity.

The owner's Persian month labels are explicit in the renderer. **Month-name substitution is not a Gregorian calendar conversion.** A concrete numeric Iranian date must retain its original calendar, labelled `بالتقويم الإيراني`; a substitution that pretends to establish a Gregorian date is blocked. Unresolved concrete dates remain reviewable. Literal quotations are never rewritten merely for typography. Outside protected quotes, إسرائيل receives the owner's double-quote convention.

Older PDF policies remain preserved as `legacyPolicy`; a versioned client override supplies current generation defaults. T03 is no longer a blind automatic substitution because it can manufacture identity from the generic phrase “leader of the 1979 revolution.”

## Arabic reasons

`editorial-eligibility.ts` centrally maps evidence/speaker, incomplete extraction, language, numeric/date/name/fact mismatch, quote, attribution/uncertainty, rendering, source, rank, terminology, dedup/conflict and human-approval codes. Important labels include:

| Code | Arabic |
|---|---|
| SPEAKER_ATTRIBUTION_MISMATCH | نسبة التصريح إلى المتحدث غير مؤكدة |
| AMBIGUOUS_EVIDENCE_CONTEXT | سياق المعلومة في المصدر غير واضح بما يكفي لاعتماد الصياغة |
| UNSUPPORTED_OUTPUT | تتضمن الصياغة العربية معلومة غير مدعومة بوضوح من المصدر |
| SOURCE_LANGUAGE_UNCERTAIN | تعذّر تحديد لغة المصدر بشكل موثوق |
| INCOMPLETE_EXTRACTION | تعذّر استخراج المعلومات الأساسية من الخبر بشكل كامل |
| NUMBER_MISMATCH / ARABIC_RENDERING_NUMBER_MISMATCH | يوجد رقم في الصياغة لا يطابق المصدر |
| IDENTITY_AMBIGUOUS | هوية أحد الأشخاص المذكورين غير واضحة |
| ATTRIBUTION_LOST | الصياغة لا تحافظ بوضوح على نسبة الادعاء إلى مصدره |
| UNCERTAINTY_LOST | المصدر يعرض المعلومة كغير مؤكدة بينما الصياغة تعرضها كحقيقة |
| QUOTE_INTEGRITY_FAILURE / QUOTE_REVIEW | الاقتباس في الصياغة لا يطابق المصدر بشكل موثوق |
| MATERIAL_DATE_MISMATCH | التاريخ الوارد في الصياغة لا يطابق المصدر |
| MATERIAL_NAME_MISMATCH | اسم مهم في الصياغة لا يطابق المصدر بشكل موثوق |
| MATERIAL_FACT_OMISSION | الصياغة أغفلت معلومة أساسية تؤثر في معنى الخبر |

Unknown codes receive a safe Arabic fallback; raw codes stay in expandable engineering/audit details. Duplicate explanations collapse; factual integrity takes priority. Safe exact unresolved Arabic names/terms remain visible. Technical errors show `تعذّرت معالجة الخبر بسبب خطأ تقني، وسيحتاج إلى إعادة المحاولة`, not sensitive provider payloads.

## Provider/cost path

Production constructs GeminiLanguageProvider only: native Gemini 3.1 Flash-Lite for extraction, evidence rendering, rendering review, ID classification, semantic comparison and final atom selection. It delegates schema/validation orchestration to GroqLanguageProvider with injected Gemini transport. No Groq request or fallback is made by this worker. Groq and OpenAI remain optional local adapters; neither was deleted or activated.

Historical GROQ_REQUEST_LIMIT referred to the shared runner's eight-request budget, not evidence of Groq billing. Plausible-event comparisons can consume that budget. Identical comparison payloads now reuse one response within the job; separate event temporal/conflict decisions remain intact, and multiple matching events still require review. No candidate is skipped based merely on a cost cap and the budget was not raised.

## Nondestructive replay

Command: `node node_modules/tsx/dist/cli.mjs scripts/replay-editorial.ts <private-snapshot.json> <private-report.json>`.

The harness imports no database client, ingestion adapter, live provider or publisher. It hashes the input, validates saved contracts, reconstructs drafts only where saved evidence exists, retains matching/conflict failures, and checks that input bytes did not change. It does not retry failed AI stages. Raw snapshots/reports stay ignored and are not committed.

Historical sample: 100 terminal jobs, cutoff 2026-09-18 18:06:37 UTC. Only 15 had a saved draft suitable for local finalization replay. Under the corrected category definitions:

| Category | Before | After local replay |
|---|---:|---:|
| Ready | 0 (0%) | 0 (0%) |
| Needs Review | 94 (94%) | 94 (94%) |
| Filtered | 1 (1%) | 1 (1%) |
| Processing Error | 5 (5%) | 5 (5%) |

The original old UI had grouped the five technical errors into review (99 review / 1 filtered). That is a presentation baseline, not a changed extraction result. The retained top errors are speaker mismatch 25, language uncertainty 21, ambiguous evidence context 21, missing validated Arabic rendering 8, request budget 3, incomplete extraction 2. The historical snapshot predates several earlier fixes; it cannot establish current live extraction failure rates.

Source breakdown: Al Alam 46, ISNA 33, IRNA 21; zero ready in each. Stored languages: Arabic 50, Persian 3, unknown/unpersisted 47. Replayed formats: 13 FLASH, 2 QUOTE_LED; 85 not re-rendered. All three source profiles were null in the snapshot. A fresh read-only production check at 2026-09-18 21:07 UTC confirmed all three enabled sources still have no editorial profile. Seventeen sample outcomes contain UNVERIFIED_SOURCE. Removing synthetic term/attestation flags does not legitimately verify these sources.

## Regression acceptance and limits

Twelve clean fixtures cover every requested SHOULD_PASS group: Arabic flash, validated Persian rendering, heading/bullets, attributed serious claim, clear new name, sourced rank, preserved numbers, preserved uncertainty, literal quote, standard paragraphs, multipoint and visual caption. All reach READY_TO_PUBLISH + HOLD with a verified fixture source. They are synthetic structures and are not claimed as live production wins.

Twelve unsafe variants remain blocked: unsupported additions, altered/invented numbers, ambiguous identity, lost attribution, unsupported rank, corrupt quote, invented date/location/outcome, incomplete extraction, ambiguous speaker, certainty upgrade and conflicting evidence context. Additional tests cover Arabic UI, eligibility/delivery matrix, month/date handling, preserved Persian production structures, ID-only contracts, matching cache, local approval/freeze, concurrent duplicate protection and human revision immutability.

No new paid AI calls were required. Replay made zero production writes and zero Telegram sends. Source verification/onboarding, genuine evidence ambiguity and insufficient stored intermediates remain blockers to demonstrating a representative *production* Ready rate. Shadow simulation can use the offline corpus now; it must not treat missing production trust evidence as satisfied. Automatic publication remains disabled.


## Exact change manifest

- `src/app/news/[id]/page.tsx`
- `src/app/posts/[id]/page.tsx`
- `src/app/review/page.tsx`
- `src/components/news-feed.tsx`
- `src/components/post-feed.tsx`
- `src/components/processing-details.tsx`
- `src/lib/labels.ts`
- `src/lib/processing/constrained-rewrite.ts`
- `src/lib/processing/contracts.ts`
- `src/lib/processing/editorial.ts`
- `src/lib/processing/engine.ts`
- `src/lib/processing/evidence-rendering.ts`
- `src/lib/processing/groq-validation.ts`
- `src/lib/processing/groq.ts`
- `src/lib/processing/id-classification.ts`
- `src/lib/processing/local-finalization.ts`
- `src/lib/processing/matcher.ts`
- `src/lib/processing/rules.ts`
- `src/lib/telegram/publisher.ts`
- `tests/constrained-rewrite.test.ts`
- `tests/id-classification.test.ts`
- `tests/local-finalization.test.ts`
- `tests/persian-processing.test.ts`
- `tests/processing.test.ts`
- `tests/rewrite-scope.test.ts`
- `src/components/editorial-state.tsx`
- `src/lib/processing/editorial-eligibility.ts`
- `src/lib/processing/editorial-grounding.ts`
- `src/lib/processing/newsroom-format.ts`
- `tests/fixtures/newsroom.ts`
- `tests/newsroom-eligibility.test.ts`
- `tests/newsroom-database.test.ts`
- `tests/newsroom-matcher.test.ts`
- `scripts/replay-editorial.ts`
- `tests/editorial-state.test.tsx`
- `docs/EDITORIAL-ELIGIBILITY.md`

UI files supply centralized Arabic states/reasons; processing files implement eligibility, scoped grounding, formatting, provider diagnostics and identical-input comparison reuse. The publisher change only permits an approved title-only flash; delivery claims, retries and idempotency are unchanged. Tests cover each changed boundary; the script is offline replay only. No ingestion/session code or Prisma schema changed.

## Verification

101 focused tests passed, zero skipped, in the intended clean checkout with isolated local PostgreSQL. Typecheck and scoped ESLint passed. Prisma schema validation passed; no migration/generation change required. Diff check and a scan against locally stored secret values and credential patterns passed (36 reviewed files). The unrelated untracked export script has a workspace type error and was not modified or included; verification excludes it by testing the exact intended commit snapshot. Production build is verified before commit. No AI/provider calls or real Telegram transports were invoked; mock transport calls belong only to local regression tests.
