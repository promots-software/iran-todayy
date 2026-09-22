import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { saveSource, changeSource, changeMode } from "../src/lib/source-service";

// Explicit dedicated database opt-in. Never run these mutations against a live database.
test("PostgreSQL persistence, audit, event constraints and publication intent", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const client = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  let sourceId: string | undefined;
  let eventId: string | undefined;
  let newsItemId: string | undefined;
  let postId: string | undefined;
  let publicationId: string | undefined;
  try {
    const source = await saveSource(client, { platform: "X", handle: `t${tag}`, name: "مصدر اختبار" }, "integration-test");
    sourceId = source.id;
    await assert.rejects(saveSource(client, { platform: "X", handle: `T${tag}`, name: "مكرر" }, "integration-test"), /SOURCE_EXISTS/);
    await changeSource(client, source.id, "disable", "integration-test");
    assert.equal((await client.source.findUniqueOrThrow({ where: { id: source.id } })).enabled, false);
    await changeSource(client, source.id, "enable", "integration-test");
    assert.equal((await client.source.findUniqueOrThrow({ where: { id: source.id } })).enabled, true);
    const post = await client.sourcePost.create({ data: { sourceId: source.id, sourcePostId: "1", sourceUrl: `${source.url}/status/1`, originalContent: "TEST FIXTURE ONLY", sourcePublishedAt: new Date() } });
    postId = post.id;
    assert.equal(post.modeAtProcessing, "REQUIRE_APPROVAL");
    assert.equal(post.status, "INGESTED");
    await assert.rejects(client.sourcePost.create({ data: { sourceId: source.id, sourcePostId: "1", sourceUrl: source.url, originalContent: "duplicate", sourcePublishedAt: new Date() } }));
    await changeSource(client, source.id, "remove", "integration-test");
    assert.ok((await client.source.findUniqueOrThrow({ where: { id: source.id } })).deletedAt);
    assert.equal(await client.sourcePost.count({ where: { id: post.id } }), 1);
    const restored = await saveSource(client, { platform: "X", handle: `t${tag}`, name: "مستعاد" }, "integration-test");
    assert.equal(restored.id, source.id);
    assert.equal(restored.deletedAt, null);
    assert.ok(await client.auditLog.count({ where: { entityId: source.id } }) >= 5);
    await assert.rejects(changeMode(client, "AUTO_PUBLISH", "integration-test"), /LEGACY_PUBLISHING_MODE_REMOVED/);
    assert.equal((await client.appSettings.findUniqueOrThrow({ where: { id: 1 } })).publishingMode, "REQUIRE_APPROVAL");
    assert.equal((await client.sourcePost.findUniqueOrThrow({ where: { id: post.id } })).modeAtProcessing, "REQUIRE_APPROVAL");
    await assert.rejects(client.appSettings.create({ data: { id: 2 } }));
    const event = await client.canonicalEvent.create({ data: { title: "TEST ONLY", summary: "TEST ONLY", facts: [], revisions: { create: { revision: 1, facts: [] } } }, include: { revisions: true } });
    eventId = event.id;
    const revisionId = event.revisions[0].id;
    const news = await client.newsItem.create({ data: { eventRevisionId: revisionId, title: "اختبار فقط" } });
    newsItemId = news.id;
    await assert.rejects(client.newsItem.create({ data: { eventRevisionId: revisionId, title: "duplicate" } }));
    await client.eventMatch.create({ data: { sourcePostId: post.id, eventRevisionId: revisionId, classification: "DUPLICATE", rationale: "Test linkage" } });
    const publicationData = { newsItemId: news.id, idempotencyKey: `event:${event.id}:revision:1`, contentSnapshot: "TEST ONLY", destination: "test-only" };
    const results = await Promise.allSettled([client.publication.create({ data: publicationData }), client.publication.create({ data: publicationData })]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    publicationId = (await client.publication.findUniqueOrThrow({ where: { newsItemId: news.id } })).id;
    await client.publication.update({ where: { id: publicationId }, data: { status: "UNKNOWN" } });
    assert.equal((await client.publication.findUniqueOrThrow({ where: { id: publicationId } })).status, "UNKNOWN");
    const secondRevision = await client.eventRevision.create({ data: { eventId: event.id, revision: 2, facts: [], materialChange: "TEST update" } });
    await client.newsItem.create({ data: { eventRevisionId: secondRevision.id, title: "TEST update" } });
  } finally {

    if (publicationId) await client.publication.deleteMany({ where: { id: publicationId } });
    if (postId) await client.eventMatch.deleteMany({ where: { sourcePostId: postId } });
    if (eventId) {
      await client.newsItem.deleteMany({ where: { eventRevision: { eventId } } });
      await client.eventRevision.deleteMany({ where: { eventId } });
      await client.canonicalEvent.deleteMany({ where: { id: eventId } });
    } else if (newsItemId) await client.newsItem.deleteMany({ where: { id: newsItemId } });
    if (postId) await client.sourcePost.deleteMany({ where: { id: postId } });
    if (sourceId) await client.source.deleteMany({ where: { id: sourceId } });
    await client.auditLog.deleteMany({ where: { actor: "integration-test" } });
    await client.$disconnect();
  }
});
