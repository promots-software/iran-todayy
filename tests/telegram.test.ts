import test from "node:test";
import assert from "node:assert/strict";

import { TelegramMonitor, type ChannelReader, type ReadMessage } from "../src/lib/telegram/monitor";
import { assertShadowMode, assertApprovalMode } from "../src/lib/processing/shadow";
import { externalPublicationDecision } from "../src/lib/processing/providers";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ingest, pollSources } from "../src/lib/processing/engine";



const signal = new AbortController().signal;
function reader(messages: ReadMessage[]): ChannelReader {
  return { channel: async () => "123", messages: async (_handle, after) => after === null ? messages.slice(-1) : messages.filter(m => m.id > after).slice(0, 50) };
}
test("shadow defaults safe, explicit opt-out fails, approval mandatory, publication denied", () => {
  assertShadowMode({}); assertShadowMode({ SHADOW_MODE: "true" });
  for (const value of ["false", "0", "TRUE", ""]) assert.throws(() => assertShadowMode({ SHADOW_MODE: value }), /SHADOW_MODE_REQUIRED/);
  for (const mode of [undefined, "AUTO_PUBLISH"]) assert.throws(() => assertApprovalMode(mode), /REQUIRE_APPROVAL_REQUIRED/);
  assertApprovalMode("REQUIRE_APPROVAL");
  assert.equal(externalPublicationDecision().allowed, false);
});
test("first poll collects available history; subsequent text and non-text messages preserve source IDs", async () => {
  const messages = [{ id: 8, text: "old", date: 1700000000 }];
  const monitor = new TelegramMonitor(reader(messages));
  const first = await monitor.poll({ handle: "irna_arabic", cursor: null }, signal);
  assert.equal(first.posts.length, 1); assert.equal(first.posts[0].content,'old'); assert.equal(first.cursor.lastId, 8);
  messages.push({ id: 9, text: "  نص أصلي\nquote  ", date: 1700000001 }, { id: 10, text: "", date: 1700000002 });
  const next = await monitor.poll({ handle: "irna_arabic", cursor: first.cursor }, signal);
  assert.equal(next.posts.length, 2); assert.equal(next.posts[0].content, messages[1].text);
  assert.equal(next.posts[1].content,'');assert.equal(next.posts[1].metadata.messageKind,'EMPTY');
  assert.equal(next.posts[0].url, "https://t.me/irna_arabic/9");
  assert.equal(next.posts[0].metadata.shadowMode, true); assert.equal(next.cursor.lastId, 10);
  assert.deepEqual((await monitor.poll({ handle: "irna_arabic", cursor: next.cursor }, signal)).posts, []);
});
test("catch-up drains oldest first in bounded pages without skipping over 50 posts", async () => {
  const messages = Array.from({ length: 123 }, (_, i) => ({ id: i + 1, text: `post ${i}`, date: 1700000000 }));
  const monitor = new TelegramMonitor(reader(messages));
  let cursor = { kind: "telegram-shadow-v1" as const, channelId: "123", lastId: 0 };
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const batch = await monitor.poll({ handle: "irna_arabic", cursor }, signal);
    ids.push(...batch.posts.map(p => p.externalId)); cursor = batch.cursor;
  }
  assert.equal(ids.length, 123); assert.equal(new Set(ids).size, 123); assert.equal(cursor.lastId, 123);
});
test("invalid cursor, reassigned channel and cancellation fail closed", async () => {
  const monitor = new TelegramMonitor(reader([]));
  await assert.rejects(monitor.poll({ handle: "irna_arabic", cursor: 2 }, signal), /CURSOR_INVALID/);
  await assert.rejects(monitor.poll({ handle: "irna_arabic", cursor: { kind: "telegram-shadow-v1", channelId: "999", lastId: 1 } }, signal), /CHANNEL_CHANGED/);
  await assert.rejects(monitor.poll({ handle: "irna_arabic", cursor: null }, AbortSignal.abort()));
});
test("flood wait pauses all channels, makes no requests during cooldown, and sanitizes errors", async () => {
  let now = 0, calls = 0;
  const monitor = new TelegramMonitor({ channel: async () => { calls++; throw { seconds: 10, message: "SECRET" }; }, messages: async () => [] }, () => now);
  await assert.rejects(monitor.poll({ handle: "irna_arabic", cursor: null }, signal), /^Error: TELEGRAM_FLOOD_WAIT$/);
  await assert.rejects(monitor.poll({ handle: "alalamtv", cursor: null }, signal), /FLOOD_WAIT/);
  assert.equal(calls, 1); now = 12000;
  await assert.rejects(monitor.poll({ handle: "alalamtv", cursor: null }, signal), /FLOOD_WAIT/);
  assert.equal(calls, 2);
});

test("unavailable usernames return only a safe actionable code", async () => {
  for (const error of [{ errorMessage: "USERNAME_INVALID" }, { errorMessage: "USERNAME_NOT_OCCUPIED" }, new Error('No user has "private-value" as username')]) {
    const monitor = new TelegramMonitor({ channel: async () => { throw error; }, messages: async () => [] });
    await assert.rejects(monitor.poll({ handle: "irna_arabic", cursor: null }, signal), /^Error: TELEGRAM_USERNAME_UNAVAILABLE$/);
  }
});

test("live database ingestion enforces approval and preserves cursor on failure", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
  const db = new PrismaClient({ datasourceUrl: url });
  const handle = `t${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const source = await db.source.create({ data: { platform: "TELEGRAM", handle, name: "shadow test", url: `https://t.me/${handle}` } });
  const post = { externalId: "11", content: "original shadow text", publishedAt: new Date(), url: `${source.url}/11`, metadata: { shadowMode: true } };
  try {
    await db.appSettings.update({ where: { id: 1 }, data: { publishingMode: "AUTO_PUBLISH" } });
    await assert.rejects(ingest(db, source.id, post, true), /REQUIRE_APPROVAL_REQUIRED/);
    assert.equal(await db.sourcePost.count({ where: { sourceId: source.id } }), 0);
    await db.appSettings.update({ where: { id: 1 }, data: { publishingMode: "REQUIRE_APPROVAL" } });
    const first = await ingest(db, source.id, post, true);
    const replay = await ingest(db, source.id, { ...post, content: "edit must not replace original" }, true);
    assert.equal(first.id, replay.id); assert.equal(replay.originalContent, post.content);
    assert.equal(first.modeAtProcessing, "REQUIRE_APPROVAL");
    await pollSources(db, { TELEGRAM: { id: "test-live", live: true, poll: async input => {
      if (input.handle !== handle) throw new Error("unrelated source");
      return { posts: [{ ...post, externalId: "12" }, { ...post, externalId: "13", content: "" }], cursor: { kind: "telegram-shadow-v1", channelId: "123", lastId: 13 } };
    } } }, signal);
    assert.equal((await db.source.findUniqueOrThrow({ where: { id: source.id } })).cursor, null);
    assert.equal(await db.sourcePost.count({ where: { sourceId: source.id } }), 2);
    assert.equal(await db.publication.count({ where: { newsItem: { evidence: { some: { sourcePostId: first.id } } } } }), 0);
  } finally {
    await db.appSettings.update({ where: { id: 1 }, data: { publishingMode: "REQUIRE_APPROVAL" } });
    await db.processingJob.deleteMany({ where: { sourcePost: { sourceId: source.id } } });
    await db.sourcePost.deleteMany({ where: { sourceId: source.id } });
    await db.source.delete({ where: { id: source.id } });
    await db.$disconnect();
  }
});
