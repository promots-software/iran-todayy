# Dashboard manual publication

Review the candidate's source evidence and every editorial flag on its detail page.
Document each human review resolution, then approve. Approval freezes the exact
text and destination; it does not send. Review the frozen preview, check the
separate send confirmation, then choose **نشر مرة واحدة على Telegram**.

The authenticated dashboard server requires these environment variables:

- `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (server-only production secrets)
- `TELEGRAM_MANUAL_PUBLISH_ENABLED=true`
- `REQUIRE_APPROVAL=true`, `AUTO_PUBLISH=false`, `SHADOW_MODE=true`
- Keep `TELEGRAM_PUBLISH_ENABLED=false` for the automatic/legacy publishing gate.

Configure the manual capability only on Vercel, not the Railway ingestion worker.
There is no environment mutation or global shadow-mode override in a request.
The database publishing mode must also remain `REQUIRE_APPROVAL`.

The existing durable claim is shared by CLI and dashboard delivery. It allows one
attempt only. Concurrent requests and refreshes do not resend. A network timeout,
lost acknowledgement, or failed result persistence leaves `UNKNOWN` or `SENDING`;
these states, and explicit `FAILED` responses, require operator reconciliation.
Telegram provides no sendMessage idempotency key: delivery cannot be proven after
an ambiguous response, so the application deliberately never retries it.

Approval and send outcomes are audited. Successful delivery stores the Telegram
message ID and changes the candidate to `PUBLISHED`. Failed processing and
non-editorial validation errors cannot be resolved by the approval form.

## Focused offline verification

Use a local PostgreSQL database through `TEST_DATABASE_URL` for
`tests/publication-database.test.ts` and `tests/database.test.ts`.
`tests/telegram-publisher.test.ts` exercises the transport with injected mocks.

For `tests/telegram-publish-path.test.ts`, start a local Next server with the same
local database, synthetic admin credentials, token `123:offline`, destination
`-100123`, and the safeguards above. Preload
`tests/helpers/manual-publish-transport.cjs` using `NODE_OPTIONS=--require=...`.
The helper blocks external networking and rejects a second transport call.
Set `TEST_BASE_URL` and matching synthetic admin credentials in the test process.
This exercises the actual authenticated approval/send Server Actions with no
real Telegram traffic, including missing confirmation and repeated submissions.

## Human editorial revisions after failed processing

A separate `HumanEditorialDraft` links to either a failed source post or an existing
news item. The original records, AI output, validation statuses, source text and
errors are never rewritten. The first edit snapshots the original record; every
saved human revision is audited with actor, timestamp, text and original failure.
This is human responsibility, not an automated grounding pass.

On a review item choose **حفظ المسودة**, document editorial/source review, then
**اعتماد النسخة المحررة** and confirm responsibility. Approval freezes only the
saved revision. Review its exact preview and destination before the separate
publish confirmation. These drafts are refused by the legacy/automatic send path.

Changing approved text marks the previous unsent publication `CANCELLED`, retains
its snapshot/audit, and clears approval. A new approval is required. Stale forms
fail closed. A common transaction lock serializes editing, approval and durable
send claims. After any send attempt, editing is locked; sent history is immutable.
The original AI candidate remains failed or in review; the separate human draft
is labeled DRAFT / APPROVED / PUBLISHED and appears in the human review/published
queues. The existing single-admin authentication records the configured admin
username; it does not distinguish people sharing that account.

Deploy the additive `202609180001_human_editorial` migration before this dashboard
release. No source/news data is rewritten. Focused tests: `human-editorial.test.ts`
and `human-editorial-http.test.ts`, using only the local test database and mocked
transport described above.
