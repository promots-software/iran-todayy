# Automatic publication contract

## Processing and delivery

NORMAL and DIRECT select processing contracts, never delivery permission. Processing
stores READY_TO_PUBLISH for validated, non-duplicate output with no blocking review
reason. Its delivery decision is always HOLD: only the dedicated publisher grants
transport authority under the current runtime policy.

| Processing mode | Effective automatic delivery ON | OFF |
| --- | --- | --- |
| NORMAL | Freeze and claim one Telegram publication | Remain READY |
| DIRECT | Freeze and claim one Telegram publication | Remain READY |

ON requires the current database ACTIVE/CANARY policy, authorized source and time
boundary, matching Telegram destination, no publishing hold, and the deployment
capability flags AUTO_PUBLISH=true, TELEGRAM_PUBLISH_ENABLED=true,
SHADOW_MODE=false, REQUIRE_APPROVAL=true. The database policy can revoke/restore
permission without redeployment. Processing workers retain isolated safe flags.

## Changes and safety

- `publication-policy.ts` is the shared eligibility policy, used before freezing
  and again inside the durable send claim. Legacy DIRECT entry points delegate to
  the same policy and cannot bypass TEST exclusion or runtime authorization.
- The previously active automatic worker already supported both processing modes.
  The defect was divergent legacy policy plus inconsistent rechecks, not a blanket
  inability to publish NORMAL stories.
- Source eligibility follows immutable factual contributors. Later duplicate
  evidence links are preserved for traceability but do not veto or authorize the
  original story. Missing factual-source links fail closed.
- NORMAL scope checks and DIRECT full-source coverage remain unchanged. Stale
  processing modes, failed evidence, unresolved matching, incomplete jobs, human
  edits, and blocking editorial reasons cannot become unattended publications.
- Operational delivery flags do not create editorial review reasons. Actual
  factual review remains blocking. Manual human approval remains separate.
- UNKNOWN acknowledgement receipts now reconcile idempotently: repeated recovery
  preserves the same outcome and audit entry, never retries Telegram, and rejects
  conflicting receipts. Previously repeated recovery hit the unique audit ID.
- Frozen content/destination digests, transactional locks, single attempt claims,
  receipt journaling and DB-only reconciliation remain enforced. An authorization
  change before claim holds the publication without reclassifying the story.

## Verification (offline)

`tests/automatic-contract.test.ts`: 29/29 passed, including all 22 required cases,
duplicates with AUTO OFF, distinct concurrent stories, linked duplicate evidence,
runtime revocation after freeze, and factual failure before claim.

Adjacent suites: 99/99 passed (automatic delivery, DIRECT Arabic/non-Arabic,
reconciliation, Telegram transport, manual/human publication, processing database,
matcher, stale-mode transitions, semantic safeguards, and editorial eligibility).
Total: 128 passed, 0 failed, 0 skipped across 13 files. Providers and Telegram were
local fakes; databases were isolated loopback databases.

No schema/migration, quota, cost guard, source settings or production policy change
is part of this release. Production verification is read-only; any naturally
occurring real delivery belongs to the already-authorized running worker.
