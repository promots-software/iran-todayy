import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../lib/db";
import { retryDelay } from "../lib/domain";

const id = process.env.WORKER_ID || `foundation-${randomUUID()}`;
const configuredInterval = Number(process.env.WORKER_HEARTBEAT_MS ?? 15000);
const intervalMs = Number.isFinite(configuredInterval) ? Math.min(60_000, Math.max(1000, configuredInterval)) : 15000;
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());
function log(level: string, event: string) {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, worker: id, event, phase: "FOUNDATION" }));
}
async function pause(ms: number) {
  try { await sleep(ms, undefined, { signal: stop.signal }); }
  catch (error) { if (!stop.signal.aborted) throw error; }
}
async function main() {
  let failures = 0;
  let registered = false;
  const startedAt = new Date();
  log("INFO", "worker_starting");
  try {
    while (!stop.signal.aborted) {
      try {
        await db.workerHeartbeat.upsert({ where: { id }, create: { id, state: "IDLE", startedAt, intervalMs, metadata: { processingEnabled: false } }, update: { state: "IDLE", startedAt, lastSeenAt: new Date(), intervalMs, lastError: null, metadata: { processingEnabled: false } } });
        if (!registered) {
          await db.auditLog.create({ data: { action: "WORKER_STARTED", entityType: "WorkerHeartbeat", entityId: id, message: "بدء عامل المرحلة الأولى — نبضات حالة فقط" } });
          registered = true;
        }
        failures = 0;
        log("INFO", "heartbeat_idle_no_processing");
        await pause(intervalMs);
      } catch {
        failures++;
        log("ERROR", "database_unavailable_retrying");
        await pause(retryDelay(failures));
      }
    }
  } finally {
    if (registered) {
      try {
        await db.$transaction([
          db.workerHeartbeat.update({ where: { id }, data: { state: "STOPPED", lastSeenAt: new Date() } }),
          db.auditLog.create({ data: { action: "WORKER_STOPPED", entityType: "WorkerHeartbeat", entityId: id, message: "توقف العامل" } }),
        ]);
      } catch { log("ERROR", "shutdown_status_write_failed"); }
    }
    await db.$disconnect();
    log("INFO", "worker_stopped");
  }
}
main().catch(() => { log("ERROR", "worker_fatal"); process.exitCode = 1; });
