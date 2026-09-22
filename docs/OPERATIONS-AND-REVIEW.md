# Operations, users and draft preservation

## Permissions / recovery

Existing ADMIN and EDITOR accounts retain their roles. SUPER_ADMIN is additive, uses the same hashed-password/session auth, and inherits ordinary admin access. `/operations/**` and every operational server action require SUPER_ADMIN. ADMIN cannot create/promote/edit a SUPER_ADMIN, including through forged server-action input. Changes revoke target sessions. The last enabled administrative account and last enabled SUPER_ADMIN are protected under the existing user-management lock.

The owner's requested new `adel` account is provisioned separately after migration with a locally entered password. `prepare-super-admin.ps1` hides both prompts, passes the password over private stdin, saves only scrypt hash to ignored/access-restricted storage. `create-prepared-super-admin.ts` creates only a previously absent `adel`, audits creation, deletes the prepared hash. It is never run by builds/migrations. No automatic promotion of existing users.

There is no email recovery. An authorized administrator can reset an ordinary account using the existing password form; SUPER_ADMIN can reset privileged accounts. Loss of the last SUPER_ADMIN requires separately authorized operator recovery, not an unauthenticated web endpoint. Passwords/hashes are never displayed.

## Runtime source mode

The engine reads persisted Source.processingMode at attempt start, rechecks after understanding, and locks/rechecks before decision commit. Pending jobs use the current mode. A mid-attempt change prevents stale-mode commit and schedules a bounded retry; mode participates in checkpoint input, so NORMAL and DIRECT results cannot be confused. Successful historical decisions do not change retroactively. Source changes require no redeployment.

DIRECT bypasses scope/relevance/topic/priority acceptance selection. It does not bypass grounding, full source coverage, translation review, attribution, duplicates or uncertain matches. Clean output is PENDING_APPROVAL/READY_TO_PUBLISH independently of SHADOW_MODE/AUTO_PUBLISH. The processing worker never sends. `publishReadyDirect` is the separate guarded delivery entry point; it is not newly scheduled or enabled here. Human-edited versions remain manual-only. NORMAL retains full selection behavior.

## Available draft is not validated content

Display-only `available-draft-v1` proposals live inside processingResult with validated:false and the original failure reason. They have no receipt, approval, candidate/publication side effects. Arabic generated publication proposals are retained on later grounding failure. Persian/English proposed factual translations are retained verbatim as unvalidated editor assistance; no invented connective attribution. Existing generated draft is retained if finalization fails. No original-source fallback is copied into editable fields. An existing saved human draft always wins. Errors and prior results remain in audit; original content never changes.

Malformed/non-Arabic/unsafe-to-display proposals remain empty. Absence of generated usable Arabic is reported honestly, not filled with original Persian. No historic failed jobs are requeued to backfill drafts.

## Controls and semantics

- All controls require explicit checkbox confirmation, fresh server-side role checks, optimistic expected-state checks, unique operation IDs and audit before/after state. Repeated request IDs cannot create duplicate effects.
- Source enable/mode/processing pause are DB-driven. Processing holds block new job claims only; in-flight work completes. Ingestion is independent. Source disable preserves data/checkpoints.
- Emergency publication hold shares the publication lock and blocks new Telegram/WEB claims. It cannot recall a send already claimed/in flight. Lifting the hold does not change AUTO_PUBLISH, SHADOW_MODE, REQUIRE_APPROVAL or TELEGRAM_PUBLISH_ENABLED, and grants no approval.
- Retry is only available for enumerated technical failures with no human draft/candidate. An incomplete or non-replay-safe provider checkpoint blocks it. Existing job ID retained, original failure audited, one additional bounded attempt permitted. No historical publication retry exists.
- Opening/refreshing any operations page performs reads only. Optional 60-second refresh stops while a control is open or the tab is hidden.

## Metrics definitions and limits

- Today is Beirut local midnight; SourcePost status buckets are disjoint. Material-update and processing-mode counts are separate dimensions; unprocessed/historical rows without recorded mode are UNRECORDED, never inferred from today's source mode.
- Publication counts are all-time Publication rows, separate from source counts. PENDING is not proof of non-delivery. SENDING/UNKNOWN require reconciliation; no Telegram API probe or resend is made.
- Provider statistics cover rolling 24 hours, exclude checkpoint replays from network attempts, and explicitly show unknown token usage. Measured/accounted costs are application estimates, not provider invoices. Outstanding reservations are not billed spend. External $60 monthly cap is owner-provided, not fetched or changed.
- Quotas come from existing providerCapacitySnapshot, not obsolete hardcoded Free-tier labels. No quota/cost/concurrency changes.
- Heartbeat is observed worker telemetry, not Railway/Vercel platform status. Runtime commit is shown only from platform-supplied metadata. No invented deploy history/time or prepaid balance.
- Failure center and inspector are bounded lists; missing duration remains unmeasured. Historical end-of-job stage audit times are not independent stage timers. Raw provider request payloads/checkpoint output/secrets are not exposed.

## Migration

Add enum SUPER_ADMIN and default-false processing/publishing holds. No destructive changes, table rewrites by application code, deleted history, new cascading foreign keys, or unique constraints on existing data. New holds preserve prior behavior when false. Apply migrations before running code querying the new columns.
