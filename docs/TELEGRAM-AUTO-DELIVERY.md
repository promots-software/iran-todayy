# Telegram automatic delivery

## Roles and gates

The Railway `worker:production` supervisor runs separate ingestion/processing and Telegram delivery processes. The processing role retains its existing SHADOW_MODE=true, AUTO_PUBLISH=false, REQUIRE_APPROVAL=true, TELEGRAM_PUBLISH_ENABLED=false safeguards. The delivery role receives no Gemini keys or Telegram USER session. It uses the actual Railway delivery flags plus an explicit DB policy. No additional hosting service is needed.

For delivery, AUTO_PUBLISH=true, SHADOW_MODE=false, REQUIRE_APPROVAL=true and TELEGRAM_PUBLISH_ENABLED=true are necessary but insufficient. A CANARY/ACTIVE policy must name destination, allowed source IDs and a freshness cutoff. The database publishing mode remains REQUIRE_APPROVAL: clean original AI output has a narrowly guarded automatic freeze authorization; unsafe/uncertain/human-edited stories never obtain it. Manual paths remain available on the separately configured dashboard.

Source modes are read again before freeze and claim. DIRECT bypasses editorial selection, never safety; NORMAL retains relevance/scope/selection checks. Existing sources are not altered. Source allowlisting is independent of processing mode; the synthetic TEST source is excluded from public delivery by the owner's explicit instruction. Newly added sources are not automatically added to a delivery authorization.

## Delivery and recovery

PENDING -> atomic SENDING claim + attempt + audit (one transaction) -> one Bot API request -> durable attempt receipt -> aggregate SENT/FAILED/UNKNOWN transaction + audit.

The unique publication/digest and conditional attemptCount=0 claim serialize repeated requests. Acknowledgement persistence and finalization each retry database operations only, at most three times. No send callback is retried. Recovery consumes a validated stored receipt bound to the publication digest and destination; it persists message ID, timestamp, candidate status and audit atomically. Publisher startup performs DB-only reconciliation even when sends are disabled.

A stale SENDING claim with no durable receipt becomes UNKNOWN. No receipt means no invented SENT, and never a resend. If the DB remains unavailable during acknowledgement persistence, a sanitized acknowledgement recovery record is written to runtime logs (publication/digest/chat/message identifiers only). Delivery stops. An operator must verify that evidence against Telegram before any separately authorized reconciliation. The Bot API has no idempotency key or historical message lookup: exactly-once *successful delivery* cannot be guaranteed across an unrecorded network acknowledgement/crash. This implementation guarantees no intentional retry of an uncertain send and fails closed instead of claiming success.

A crash before any durable claim leaves policy-owned PENDING safe to claim. A crash after claim, even before network transmission, is conservatively uncertain; no replay. A crash after receipt but before finalization is recoverable with no network call. Historical/manual PENDING publications have no automaticPolicyId and are never selected by this worker. Their frozen history is not rewritten. The reported historical manual PENDING publication has zero attempts, no send-start audit and no acknowledgement: the retained DB evidence cannot establish the original delivery path.

CANARY authorization names one candidate and permits only its single publication. It closes after SENT. ACTIVE authorization is refused until exactly one prior canary has SENT + message ID + one attempt + audit. Activation uses a new freshness cutoff, never a backlog sweep. Any UNKNOWN/FAILED delivery closes the current policy. Emergency publishing hold blocks new claims independently of ingestion/AI processing and cannot recall an already in-flight send.

## Operations and rollback

Operations shows publisher heartbeat/effective flags, policy state, publishing hold, uncertain states and excluded manual/historical PENDING count. Runtime-provider status is not inferred from the ingestion heartbeat.

To disarm: use Emergency Stop Publishing immediately; then set Railway AUTO_PUBLISH=false, TELEGRAM_PUBLISH_ENABLED=false, SHADOW_MODE=true, REQUIRE_APPROVAL=true. Do not delete receipts, reset attempts or resend old records. The separate processing process continues under its original safety environment.

Cost warning $1.50 and hard $2.00 rolling 24h, provider quotas, processing concurrency, source profiles and Style Profile are unchanged. Telegram transport remains escaped HTML, one bold branded first line, one blank line before body, title-only FLASH without fabricated body.
