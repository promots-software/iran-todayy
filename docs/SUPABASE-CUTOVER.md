# Fresh Supabase cutover

This is a fresh installation, not a Neon data migration. No SourcePosts, news,
publications, attempts, jobs, sessions, or old audit rows are copied.

## Connections (Prisma 6)

- Runtime `DATABASE_URL`: Supavisor transaction pooler (6543), with
  `pgbouncer=true` and `sslmode=require`. Retain the worker's existing four-connection
  client limit; bound the serverless dashboard pool separately.
- Migration `DIRECT_URL`: session pooler (5432) on IPv4, or a direct connection
  where IPv6 is available. Never run migrations through transaction pooling.
- `scripts/set-supabase-connection.ps1` accepts hidden templates/password and writes
  only ignored `.env.supabase`. It URL-encodes the password locally.
- `node --env-file=.env.supabase scripts/prisma-database.mjs migrate` applies the
  current migrations without requiring a new schema or a new provider adapter.

## Fresh initialization

Before credentials are seeded, enable RLS on application tables and revoke table
and sequence access from Supabase `anon` and `authenticated`. The existing Prisma
server connection must use a role with appropriate private server access; do not
expose these tables through public Data API policies.

Explicitly inspect the latest message boundary of each configured Telegram source.
Record the channel ID, message ID and capture time. This is an operator-authorized
fresh-start boundary, not an ingestion failure recovery mechanism. Ordinary
ingestion pagination/checkpoints are unchanged. Never initialize a fresh source
with a fabricated ID or use this procedure to skip pending production messages.

Create a private JSON configuration containing `destination` and `sources`.
Each source requires `handle`, `name`, `processingMode`, `editorialProfile`,
`cursor` (the existing `telegram-shadow-v1` format), and `capturedAt`.
Use the four owner-authorized Telegram sources: TEST `jsjsjsjwjwjwjwkaj` (DIRECT),
`isna94`, `irna_ar`, `alalamarabic` (NORMAL). Preserve the approved source profiles.
X placeholders are not required for current Telegram runtime operation.

With `ADMIN_PASSWORD` supplied privately, run:

```text
node --env-file=.env.supabase --import tsx scripts/initialize-fresh-database.ts --confirm-fresh <private-config.json>
```

The script refuses existing application state. It creates `adel` as SUPER_ADMIN
using the existing scrypt password hashing, sources, a CLOSED automatic-delivery
policy with those source IDs, and a new initialization audit. It never invokes a
provider or Telegram transport. The policy is CLOSED/OPERATOR_DISABLED; emergency
hold is not used as a substitute for the authoritative policy.

## Runtime cutover

Update only database connection variables in Railway and Vercel. Remove obsolete
Neon connection variables from production. Keep provider budgets/concurrency and
publishing transport prerequisites unchanged. The authoritative database policy
stays CLOSED, so the publisher must acknowledge DISABLED even if its transport
capabilities are enabled. The ingestion child still forces SHADOW_MODE=true and
cannot publish; the publisher child has no Telegram user-session or AI credentials.

Deploy the reviewed commit to both runtimes. Verify migration count, both worker
heartbeats, new source cursors, policy/acknowledgement, protected Data API grants,
Settings/login, and absence of historical candidates. Newly arriving posts after
the explicitly recorded boundary may enter the normal pipeline; do not mistake
them for historical rows or manually requeue them. Do not enable auto-publishing
or send a test message during cutover verification.
