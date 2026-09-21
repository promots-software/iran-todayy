# Gemini application cost safety

The shared production request transport reserves conservative request cost under
one PostgreSQL advisory transaction lock before any uncached Gemini request.
Successful measured usage replaces its reservation once; failed or unknown usage
retains the conservative reservation. No separate spend ledger is introduced.

Configuration (invalid values fail startup):
- GEMINI_COST_WARNING_USD_24H=1.50
- GEMINI_COST_HARD_LIMIT_USD_24H=2.00
- GEMINI_MAX_TRANSIENT_RETRIES=2 (0–2)

Warning does not block. A request whose reservation exceeds remaining capacity
waits as PROVIDER_COST_WAIT. Existing fair claims reconsider cost waits on fresh
healthy capacity; network admission always checks again atomically. Telegram
collection uses its independent loop and is never gated by AI cost.

A provider operation is identified by SourcePost plus exact request hash. Its
reservation count persists across restarts/windows: initial attempt plus at most
two retries. Definitive transient HTTP failures use durable exponential/jittered
backoff and honor provider waits; no lane sleeps awaiting the provider. At the
ceiling PROVIDER_RETRY_EXHAUSTED remains a technical RETRY hold, checked no more
than daily, with ZERO further network attempts for that operation. It requires
explicit operational reconciliation; expiration does not reset the attempt cap.
Unknown transport outcomes retain their existing non-replayable checkpoint.

Heartbeat processingCapacity.cost exposes accounted, measured usage estimate,
outstanding reserved USD, warning, remaining capacity and OPEN/CLOSED state.
OPEN means accounted cost has reached the hard threshold. A larger individual
reservation can still be refused while CLOSED. costWaitJobs and
transientFailures24h are operational counters. Provider billing is not measured
by these application estimates. Quotas, model, concurrency, source settings and
publishing flags are not modified by this control.
