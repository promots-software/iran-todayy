import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const sources = await db.source.findMany({ select: { platform: true, handle: true, enabled: true, deletedAt: true } });
  const expected = ['TELEGRAM:irna_arabic', 'TELEGRAM:isna94', 'TELEGRAM:alalamtv', 'X:alarabiya', 'X:sputnik_ar'];
  for (const key of expected) {
    assert.ok(sources.some(source => `${source.platform}:${source.handle}` === key && source.enabled && !source.deletedAt), `Missing enabled initial source: ${key}`);
  }
  const settings = await db.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  assert.equal(settings.publishingMode, "REQUIRE_APPROVAL");
  const migrations = await db.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`;
  assert.ok(migrations.some(m => m.migration_name === "202609150001_foundation" && m.finished_at && !m.rolled_back_at));
  console.log(JSON.stringify({ connected: true, initialSourcesVerified: expected.length, publishingMode: settings.publishingMode, migrationVerified: "202609150001_foundation" }));
} catch {
  console.error("Database verification failed: check connectivity, migration, seed and default setting. No credentials were printed.");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
