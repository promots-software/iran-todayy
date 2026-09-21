# DIRECT publication corrections

Arabic DIRECT now requests verbatim evidence, safety labels, complete source-unit
coverage, and an untrusted Arabic title/body proposal in one structured response.
Facts retain original evidence and local f1/f2 IDs. No classification request.

Coverage is checked before accepting the proposal: every original nonempty line
must be represented; only standalone URLs/handles can be excluded. Exact fact
and speaker spans (NOT broad context windows) must cover its lexical content.
A small speech-connector allowance cannot hide dates, conditions, negation or
future actions. This deliberately fails closed on unexplained narrative.

The one-call route allows only exact copy/punctuation cleanup and the explicit
safe MSA future transformations in safeArabicEdit. It cannot resolve pronouns,
change facts, merge claims or discard qualifiers. More ambitious copy uses one
independent direct_publication_review request against full original source,
immutable facts, coverage and sentence references. Missing/uncertain coverage,
meaning or quality fails closed. The awkward-Arabic fixture demonstrates this
second-call route; it does not establish live model quality or fallback rates.

Local checks reject invalid IDs, uncovered facts, changed numbers/date markers,
changed named anchors/speakers and altered literal quotations. Independent review
must confirm every sentence and full-source preservation. It is not the
extractor's self-attestation. Receipts bind source and immutable facts; final
construction revalidates receipt and uses exactly the approved proposal before
existing deterministic editorial rules. Source evidence is never rewritten.

Contained attribution now supports explicit Arabic feminine/conjunction forms
and Persian speaker-first speech verbs. Direct statement schemas separate
unattributed FACT from explicit-speaker STATEMENT/CLAIM/DECISION/etc; contradictory
FACT + speaker responses are invalid in both Arabic and bilingual requests.

Persian keeps its two-call combined extraction/translation plus independent
full-source translation review, with existing final local rendering. NORMAL
processing is unchanged except the narrowly justified attribution parser fixes.
New DIRECT checkpoint versions prevent old incomplete contracts from silently
qualifying as new publication receipts. Historical jobs are not requeued.

No schema/migration, source policy, quota, cost, concurrency, publishing or
approval changes. Requests keep the existing output cap and fail on truncation.
The conservative coverage/anchor checks may still route complex safe copy to
review; the separately authorized live test must measure that rate.
