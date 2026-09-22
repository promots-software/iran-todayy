# Newsroom flow audit and release verification

## Current flow and gate ownership

- Telegram ingestion persists SourcePost + ProcessingJob idempotently; collection and processing remain independent. No collector changes.
- NORMAL: one broad Iran relevance decision during extraction. Uncertain relevance is accepted; only IRRELEVANT excludes. The decision survives repair. Classification cannot change relevance, factual identities or evidence.
- DIRECT: skips source-level editorial selection; retains language, exact evidence, speaker, completeness and independent non-Arabic rendering validation.
- Matching: exact DIRECT duplicates are eliminated before provider work. Semantic matching operates on immutable extracted facts. DUPLICATE and UNCERTAIN_MATCH cannot create final candidates. Material updates use existing source-grounded matching, not independent truth claims.
- The optimized Arabic DIRECT extraction request also proposes untrusted copy. This is not a committed final article: matching still precedes the draft/finalization/NewsItem boundary. Other paths generate the final article after matching. No final item or publication is created for duplicates.
- Generation and independent semantic review receive the original source and complete byte-checked 40-section contract. Persian/English evidence renderings are intermediate receipts, not the final publication prose. Every final article uses the shared canonical renderer.
- Exact excerpts, unique context/offsets, immutable IDs, numbers/dates/entities, quote integrity and attribution remain factual gates. Semantic paraphrases require independent review; local acceptance remains restricted to proven transformations.
- One provider-level repair budget is shared by extraction and final article generation. Transport/quota errors are not repair calls. Unresolved factual defects remain review; technical/provider failures stay technical. Local punctuation repair does not change facts or frozen history.
- READY is independent from publishing permission. The processor never sends. Human edits require explicit approval. The dedicated publisher checks current DB policy, source authorization, fresh runtime capabilities, evidence receipts, matching, frozen content and exactly-once claims.

## Demonstrated defects and targeted changes

1. Stored production extraction rejected solely because uncovered `، و` joined two exact source clauses. Both original and repair responses reproduced it offline. Only a joining conjunction between grounded spans is exempted; omitted negation, conditions, dates, unknown words or missing clauses still fail. Context is never counted as covered evidence. Existing held rows were not altered or replayed.
2. Legacy title-attribution verb matching rejected an independently checked speaker-colon construction. Canonical receipts are revalidated against exact title/body before recognizing their independent attribution check; missing/failed/changed receipts cannot bypass validation.
3. Final generation lacked the existing bounded repair path. It now shares the single repair allowance with extraction and receives the same complete contract.
4. Settings admitted only administrators and gated normal mode changes to SUPER_ADMIN. The authenticated radio/Save UI now permits all three editorial roles. DB role/activation checks remain under the auth lock. Emergency Stop, recovery, user management and unrelated operations retain their elevated permissions.
5. Mode changes reused an old policy revision/cutoff. Changes now issue a new revision; enabling sets a fresh ingestion/source-time boundary. Historical records remain untouched. Unresolved automatic claims from ANY revision prevent re-enabling, and unknown outcomes stop delivery.
6. Publisher acknowledgement formerly followed delivery. It now records/audits the observed revision before delivery and fences candidate selection against a different revision. Requested state remains distinct from effective state.
7. Story surfaces showed only a source name, or a delivery destination in place of source. Shared metadata now shows stored ingestion name, handle, platform and validated stored post URL, including published and human-edited queues. Article attribution stays separate.

## Regression coverage

- Selection/acceptance, repair bounds, factual vs technical review: processing-contract, direct-style, newsroom-flow.
- Canonical file integrity, ar/fa/en NORMAL/DIRECT final rewriting, independent grounding, repair contract and attribution: editorial-contract, direct-bilingual, direct-newsroom, direct-grounding-fixes.
- Evidence/matching and material updates: direct-gold (50 offline fixture dispositions), newsroom-matcher.
- All editorial roles, stale requests, mode audit, acknowledgement, older unresolved claims, emergency/recovery separation: publishing-mode, auto-publish-control, operations, auto-publish-recovery, dashboard-auth.
- Source visibility and actual rendered HTML across statuses; single radio group and privileged user-list isolation: ingestion-source-ui.
- Delivery claims, freeze, duplicates, persistence, human-edited approval: automatic-contract, automatic-delivery, telegram-publisher, publication-claim, publication-database, human-editorial.
- Final punctuation and cost controls: publication-quality, cost-safety.

No schema migration, source-mode/allowlist change, production mode toggle, historical requeue, intentional provider call or test send is part of this release.
