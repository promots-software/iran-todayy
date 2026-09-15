import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

test("seed reruns preserve operator source choices and publishing mode", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const client = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const source = await client.source.findUniqueOrThrow({ where: { platform_handle: { platform: "TELEGRAM", handle: "irna_arabic" } } });
  const settings = await client.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  try {
    const count = await client.source.count();
    await client.source.update({ where: { id: source.id }, data: { enabled: false, deletedAt: new Date() } });
    await client.appSettings.update({ where: { id: 1 }, data: { publishingMode: "AUTO_PUBLISH" } });
    execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }, stdio: "pipe" });
    const after = await client.source.findUniqueOrThrow({ where: { id: source.id } });
    assert.equal(after.enabled, false);
    assert.ok(after.deletedAt);
    assert.equal(await client.source.count(), count);
    assert.equal((await client.appSettings.findUniqueOrThrow({ where: { id: 1 } })).publishingMode, "AUTO_PUBLISH");
  } finally {
    await client.source.update({ where: { id: source.id }, data: { enabled: source.enabled, deletedAt: source.deletedAt } });
    await client.appSettings.update({ where: { id: 1 }, data: { publishingMode: settings.publishingMode } });
    await client.$disconnect();
  }
});
