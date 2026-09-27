# CANONICAL_RETRIEVAL_V1

Frozen reconstruction, NOT recovered Phase-2 code or provenance. No in-sample tuning is authorized after this freeze. Future validation must use held-out news. Historical recall is not proof of future semantic recall.

## Inputs and deterministic contract

Implementation: `src/lib/processing/canonical-retrieval.ts`. Fixture: `tests/fixtures/canonical-retrieval-v1/historical.json` (255 requests, 82 deduplicated immutable candidate versions). Every fixture has source, draft, source-publication time, evaluation time, full ordered candidate references, expected base/selection, and separate historical gold references. No saved score/rank/label is read by runtime retrieval. Historical rank and rescue draft strings were checked equal before freezing.

Runtime eligibility: latest valid EventData revision of every locally available canonical event. Invalid/legacy events retain the existing NEW_EVENT -> UNCERTAIN_MATCH hold. Candidate event creation time is retained. Candidate publication time uses the first EventMatch ordered by createdAt ascending then id ascending, falling back to event creation time when no match exists. Explicit ordering removes the prior database-dependent `matches[0]` choice; the 24-hour semantic duplicate rule itself is unchanged.

The runtime draft is the last approved canonical cycle's title + newline + body. The query is source + newline + draft. The draft is a retrieval hint, never factual authority. Source bytes and evidence offsets are not changed. Documents concatenate non-empty summary, then every fact's Arabic text and original evidence excerpt, in fact order, separated by newlines. Null/empty summary is omitted; facts/Arabic/evidence are already validated by EventData. Missing optional text is not invented. Empty query/documents score zero; empty pool selects nothing. Invalid dates or repeated immutable event/revision IDs fail with INVALID_RETRIEVAL_CATALOG.

Normalization: Unicode NFKC, lowercase, URL and ASCII-handle removal, Arabic diacritic/tatweel removal, Alef variants to Alef, Persian Yeh/Kaf to Arabic, Persian/Arabic digits to ASCII. Tokenization is Unicode letter/number runs. Ranking additionally folds ة->ه, ى->ي, ؤ->و, ئ->ي and ZWNJ to space. Rescue rare-term/phrase checks intentionally use base normalization without those extra folds.

Full local corpus supplies document frequency, not just the five-hour pool. Unique query tokens preserve their first-occurrence order. BM25 k1=1.2, b=.75:
`sum(log(1+(N-df+.5)/(df+.5))*tf*2.2/(tf+1.2*(.25+.75*length/averageLength)))`.
Fingerprint: shared rare terms (length>=4 and df<=max(1,floor(N*.1))) weighted by `log(1+N/(df+1))`, plus 2 per shared contiguous token bigram and .5 per shared ASCII numeric token. Terms/phrases are unique sets. No additional Jaccard, learned, synonym or lexical scorer is used; BM25 and this fingerprint are the lexical scorers.

Timestamp score: `1/(1+abs(candidate.sourcePublishedAt-source.sourcePublishedAt)/3600000)`. Scores use JavaScript IEEE-754 Number and Math.log without rounding/epsilon tie handling. Candidate ordering is ascending event ID (code-unit comparison); score ties retain this order. No source/message-specific rules.

Base: full-corpus BM25 order, filtered to inclusive event age [0,5] hours, first 3. Older candidates remain available for rescue. Rescue union, without a hard cap:
1. BM25<=3, fingerprint<=5, >=2 shared rare terms.
2. Both ranks<=10, >=2 shared rare terms, >=2 shared rare bigrams.
3. Nearest publication time, >=2 shared rare terms, >=1 shared rare bigram.
Rare bigrams have df<=max(1,floor(N*.1)) and both words length>=3. Output order is base ranking first, then qualifying rescues in stable event-ID order, deduplicated.

## Runtime safety and observability

Only selected candidates go to the existing compact matcher. No local lexical signal produces a semantic relationship. NEW/DUPLICATE/MATERIAL_UPDATE/UNCERTAIN remain derived from the validated matcher receipt with unchanged precedence and 24-hour window.

Full-pool snapshot transaction fencing remains intact; it is not reduced to the shortlist. Retrieval version, evaluation time, full-pool digest, query digest, base and selected revision IDs are recorded in existing JSON audit/processing fields. No migration. Version/pool/query/selection bind the compact request snapshot. Audit wall-clock time is deliberately excluded from request binding, allowing the same inputs/selection to reuse a checkpoint. A changed pool/query/selection invalidates it.

Generation, canonical checker, R1/R2, publication policy and delivery code are unchanged.

## Frozen historical results

Self-replay: 255/255. Strict-gold relationships38/38, complete decisions35/35; duplicate13/13, update7/7, uncertainty18/18.
Total selected1153 /255 = 4.52156862745098; median4; P90 7; max10; exactly3=80/255; rescue expansion173/255. Clean50 average4.76.

Agreement with OLD saved selections is251/255, not a release gate or provenance claim. Known differences (original candidate-array indices):
- 80202 key cc38d3aa17d5d937c8b1084b98bdcff3b9ad3cea2c060cd39d0a2c0bd5fdfe5e: old[8,16,3], V1[8,16,10].
- 80202 key 84f8ac28115b86c5ff91651a3a023f5394f64bc9d8b376b747309665386bdb9b: old[8,16,3], V1[8,16,10].
- 80306 key 0ef7545440107079783abff976ec631ab3fdbb8cecf897305436d50ced442e6f: old[11,20,13,2,8], V1[11,20,13,1,2,8].
- 80283 key a6fb4bebcb5ffdedd4fc1042dbb9d09281b7261b515112436ddc52781b71ba90: old[59,26,29,20], V1[59,29,32,20].

## Offline cost rebase — estimates, not measured new usage or guaranteed bounds

Actual runtime request captured using an injected in-memory transport, zero HTTP requests. Estimate each clean request input as recorded input tokens * min(1, new/old UTF8 request bytes *1.25). V1 clean50 estimated input345932.8421 tokens. Compact output proxy442.6576 tokens/call: prior calibrated14 known receipts +36 unknown imputed at largest class mean. Pricing $0.25/M input and $1.50/M output. Estimated matcher sample $0.1196825341 /61 AI stories; unchanged measured nonmatcher sample $0.21483375. Incoming usability rate628/746. No assumption of future payload compression or checker output reduction.

| Incoming/day | Matcher/day | Whole pipeline/day, excluding repairs |
|---|---:|---:|
|480|$0.7928|$2.2159|
|500|$0.8258|$2.3082|
|550|$0.9084|$2.5390|
|600|$0.9910|$2.7699|

Repair cost excluded and UNVERIFIED. Future match mix, candidate growth, output length, retries and repairs can increase spend. The earlier <$2/day model included unimplemented input/checker savings and is not claimed for this implementation.

## Next validation (not executed)

Freeze an unseen held-out cohort and independently label all relevant relationships before scoring. Compare full-pool human labels with V1, including old-event updates, cross-language matches and ambiguity. No tuning against these255. Only after that gate, separately authorize a bounded staging canary with explicit request/cost limits and Telegram blocked, verify actual native compact wire compatibility, tokens/cost and end-to-end outcomes. No deployment or resume is part of this task.

Canonical SHA256: 9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456.

## Verification at freeze

Node v24.10.0. Focused retrieval/compact/integration run:313 passed,0 failed,1 skipped (database integration requires mutation and was not executed). Relevant20-file suite:552 tests,525 passed,3 known HEAD-reproducible failures,24 skipped. Known failures: canonical-fidelity checker execution standard; canonical-fidelity compare-first instruction assertion; gemini-provider safe stage diagnostics assertion. These were not modified. Actual matcher mocked historical receipt replay:141/141 valid decisions preserved,114/114 invalid/truncated responses rejected. Typecheck, repository lint and diff check pass. No provider/database/Telegram access, no deployment or resume.
