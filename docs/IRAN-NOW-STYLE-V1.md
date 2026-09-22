# Iran Now Style Profile v1

Contract: `src/lib/processing/iran-now-style.ts`. Safety rules take precedence
over style; no additional model request or model/token-budget change is introduced.
NORMAL prompts are unchanged. DIRECT Arabic generation and DIRECT bilingual
generation receive the versioned guidance; independent reviewers retain their
existing authority. The source processing record identifies the profile version.

## Evidence and limits

Authority: the complete PDF-transcribed unified reference and Publishing Prompt
in `src/lib/processing/rules.ts`, plus the owner's explicit Telegram format.
Style evidence: local `irannow_messages.json`, SHA-256
`da16d069d3a3810748cecccb78e560280162c4d31cffbedbf7261ec16645fb0d`.
Reproduce offline: `node scripts/analyze-style-corpus.mjs <export-path>`.

The export contains 7,019 textual records / 6,769 unique texts. Its timestamps
are malformed: the purported six-day range is UNVERIFIED. No paired originals
are available, so this corpus establishes neither factual fidelity nor
Persian translation accuracy. No synthetic source pairs were created.

Measured record counts: 6,950 begin with the canonical brand; 3,911 have multiple
lines; 3,165 contain a blank line; 2,586 have colon-ended first lines; 2,580 have
bullets; 1,774 contain quote delimiters; 45 contain hashtags; 2 contain pictographs.
Character p25/median/p75/p95: first line excluding canonical brand
41/68/107/185; body among multiline posts 104/198/324/690. These are observations,
not truncation thresholds or mandatory lengths. Attribution-only historical
headlines are not learned: current informative-headline policy takes precedence.

## Deterministic versus model-assessed

Deterministic: exactly one transport branding prefix; HTML escaping; only the
first line bold; paragraph preservation; optional FLASH body; duplicate identical
title/body suppression; conservative Telegram length bound; existing quote,
number/date, exact evidence, provenance, terminology and frozen-content checks.
Protected quotations are never restyled. No forced emoji/hashtag is inserted.
Existing contextual terminology decisions still require evidence, not free substitution.

Model guidance: concise informative headlines, natural Modern Standard Arabic,
safe cleanup of awkward prose, institutional agreement, attribution placement,
distinct paragraphs, avoidance of padding/repetition and sensationalism. These
are not proven merely by a deterministic test or by the generator's assertion.
Novel Arabic paraphrases retain independent review when local checks cannot prove
equivalence. Persian rendering always retains independent full-source review.
Calendar, money, dates and units must not be converted from style statistics.

## Telegram approval compatibility

New Telegram approvals store a separate immutable formatting snapshot and bind
it into the approval digest. Canonical headline/body and plain content snapshot
remain editorial text. HTML is transport-only. Existing publication rows have a
null formatting snapshot and keep their approved plain-text behavior; no historical
publication is rewritten. WEB approvals do not gain Telegram formatting.

New text is `<b>إيران الآن | escaped headline</b>`, followed, only when a body
exists, by one blank line and escaped normal body. The dashboard renders the
same frozen structure using React text nodes, never raw HTML injection.

## DIRECT selection and safety

DIRECT skips local geography selection, AI relevance/classification requests and
downstream newsroom-selection filters (including archive priority). The legacy
internal `POLITICAL_NEWS` marker is assigned locally for contract compatibility;
it is not a model decision or an assertion that the story is political. Topic
remains UNKNOWN. Original safety labels remain in the extracted record.
Independent evidence/translation review, completeness, attribution, source flags,
unresolved terms, match conflicts and every final semantic check still apply.
Only the selection-only ARCHIVE_ONLY reason is removed from DIRECT routing.

Clean validated DIRECT output is READY_TO_PUBLISH/PENDING_APPROVAL with the safe
flags, without an operational SHADOW_MODE review. Unattended delivery remains a
separate guarded path: source eligibility, complete validated receipts, no human
override, idempotent freeze, configured destination and publishing flags are still
required. No flag is enabled by this change. NORMAL retains its previous filters,
priority and review behavior.
