# Deep functional QA release

Baseline: 2da22fb08b53060a2596b517b61cdb9d962fd875. Production state transitions are prohibited; all mutation/failure/concurrency tests use isolated loopback PostgreSQL and fake external transports. No intentional AI or Telegram calls.

## Confirmed roots under repair
- M01: entity-anchor string required in every title/body sentence, disallowing legitimate abbreviated continuation.
- M02: actual stored response used the whole sentence as context for two occurrences of the same city (institution name and explicit location). Location-only resolution now excludes already validated actor spans and requires exactly one remaining occurrence introduced by a locative preposition. Multiple remaining occurrences, absent locative grammar, and unresolved actors still fail. Layout-only projection also restores original source bytes/offsets. The stored rewrite remains subject to independent review; anaphora is not auto-resolved.
- M03: month whitelist excludes regional Gregorian equivalents.
- M04: quote delimiters rejected as uncovered prose; quote-to-indirect needs independent review, never local assertion.
- M05: unconditional actor requirement confuses an event with an agent.
- M06: ambiguous provider outcome intentionally held; technical UI/state distinction and bounded recovery to be exercised.
- M07: inspector shows stale SourcePost.status even when linked publication is SENT; list eligibility can also override PUBLISHED.
- Additional: editorial status component falsely claims Auto Publish is disabled regardless of active policy.

No release until all required checks pass.
