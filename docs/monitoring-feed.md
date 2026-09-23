# رصد — durable ingestion feed

`/monitoring` is an authenticated ADMIN/SUPER_ADMIN operational view, matching
the existing processing-log access boundary. It reads only Telegram SourcePosts
and stored source identity. It does not depend on jobs, processing status, events,
news items, or publications. Disabled/deleted-but-retained sources remain visible
in history and the source filter.

The authoritative fields are `originalContent` and `ingestedAt`. Nonempty source
text is rendered as escaped React text with whitespace preserved. Empty captions
display `منشور بلا نص`; there is no media fetch or OCR. Original links use the
existing safe URL validation.

Pages contain 50 rows, with one lookahead row and no history COUNT. Keyset order
is `(ingestedAt DESC, id DESC)`. The cursor carries that timestamp/ID tuple;
new arrivals cannot shift the next page. Filtering starts again at the newest
page. First-page refresh runs every 30 seconds only in a visible tab and pauses
while a refresh is pending. Older pages refresh only on explicit request.

The two additive indexes support global and source-filtered keyset scans.
Each is a separate `CREATE INDEX CONCURRENTLY` migration so it can run outside
a multi-statement transaction without blocking ingestion writes. Apply with the
existing migration connection before releasing the dashboard. No worker change
or worker deployment is required for this feature.

Regression coverage uses an isolated local PostgreSQL database: persistence
before job creation, failed/completed jobs, every processing status, published
article text independence, empty captions, source identity, source filtering,
pagination under new arrivals and tied timestamps, access control, and absence
of processing/provider/publishing dependencies.
