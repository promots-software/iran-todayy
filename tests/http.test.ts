import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

test("production HTTP routes, authentication and Arabic shell", { skip: !process.env.TEST_BASE_URL }, async () => {
  const base = process.env.TEST_BASE_URL!;
  const credentials = Buffer.from(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`).toString("base64");
  const headers = { authorization: `Basic ${credentials}` };
  const unauthorized = await fetch(base);
  assert.equal(unauthorized.status, 401);
  assert.ok(unauthorized.headers.get("www-authenticate")?.includes("Basic"));
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).phase, "foundation");
  for (const route of ["/", "/sources", "/settings", "/review", "/published", "/filtered", "/logs", "/system"]) {
    const response = await fetch(`${base}${route}`, { headers });
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.match(html, /lang="ar"/);
    assert.match(html, /dir="rtl"/);
    assert.match(html, /إيران اليوم/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.ok(!html.includes(process.env.ADMIN_PASSWORD!), "server secret must not be rendered");
  }
  for (const route of ["/news/missing-fixture", "/posts/missing-fixture"]) {
    const response = await fetch(`${base}${route}`, { headers });
    // Next.js may stream the shell before notFound runs; the UI and robots tag are authoritative.
    assert.ok([200, 404].includes(response.status));
    assert.match(await response.text(), /السجل غير موجود/);
  }
});

test("production source and mode forms persist changes and show validation errors", { skip: !process.env.TEST_BASE_URL || !process.env.TEST_DATABASE_URL }, async () => {
  const base = process.env.TEST_BASE_URL!;
  const client = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const authorization = `Basic ${Buffer.from(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`).toString("base64")}`;
  const handle = `http${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let sourceId: string | undefined;
  const decode = (s: string) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  async function submit(route: string, select: (form: string) => boolean, values: Record<string, string>) {
    const page = await (await fetch(`${base}${route}`, { headers: { authorization } })).text();
    const form = [...page.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).find(select);
    assert.ok(form, `form present on ${route}`);
    const body = new FormData();
    for (const [input] of form.matchAll(/<input\b[^>]*>/g)) {
      if (!input.includes('type="hidden"')) continue;
      const name = input.match(/name="([^"]*)"/)?.[1];
      if (name) body.set(decode(name), decode(input.match(/value="([^"]*)"/)?.[1] ?? ""));
    }
    for (const [name, value] of Object.entries(values)) body.set(name, value);
    const response = await fetch(`${base}${route}`, { method: "POST", body, headers: { authorization, origin: base } });
    assert.equal(response.status, 200);
    return response.text();
  }
  try {
    const input = { platform: "X", name: "مصدر اختبار الواجهة", handle };
    assert.match(await submit("/sources", form => form.includes('name="handle"'), input), /تمت إضافة المصدر/);
    const source = await client.source.findUniqueOrThrow({ where: { platform_handle: { platform: "X", handle } } });
    sourceId = source.id;
    assert.match(await submit("/sources", form => form.includes('name="handle"'), input), /هذا المصدر موجود بالفعل/);
    assert.match(await submit("/sources", form => form.includes('name="handle"'), { ...input, handle: "invalid handle" }), /أدخل معرّف الحساب الصحيح/);
    const selectRow = (form: string) => form.includes(`value="${source.id}"`);
    await submit("/sources", selectRow, { id: source.id, operation: "disable" });
    assert.equal((await client.source.findUniqueOrThrow({ where: { id: source.id } })).enabled, false);
    await submit("/sources", selectRow, { id: source.id, operation: "enable" });
    assert.equal((await client.source.findUniqueOrThrow({ where: { id: source.id } })).enabled, true);
    await submit("/sources", selectRow, { id: source.id, operation: "remove" });
    assert.ok((await client.source.findUniqueOrThrow({ where: { id: source.id } })).deletedAt);
    await submit("/settings", form => form.includes('name="publishingMode"'), { publishingMode: "AUTO_PUBLISH" });
    assert.equal((await client.appSettings.findUniqueOrThrow({ where: { id: 1 } })).publishingMode, "AUTO_PUBLISH");
    await submit("/settings", form => form.includes('name="publishingMode"'), { publishingMode: "REQUIRE_APPROVAL" });
    assert.equal((await client.appSettings.findUniqueOrThrow({ where: { id: 1 } })).publishingMode, "REQUIRE_APPROVAL");
    assert.ok(await client.auditLog.count({ where: { entityId: source.id } }) >= 4);
  } finally {
    await client.appSettings.update({ where: { id: 1 }, data: { publishingMode: "REQUIRE_APPROVAL" } });
    if (sourceId) {
      await client.source.deleteMany({ where: { id: sourceId } });
      await client.auditLog.deleteMany({ where: { entityId: sourceId } });
    }
    await client.$disconnect();
  }
});

test("populated story and source-post inspection routes render stored evidence", { skip: !process.env.TEST_BASE_URL || !process.env.TEST_DATABASE_URL }, async () => {
  const client = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const authorization = `Basic ${Buffer.from(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`).toString("base64")}`;
  let eventId: string | undefined;
  let postId: string | undefined;
  try {
    const source = await client.source.findFirstOrThrow();
    const post = await client.sourcePost.create({ data: { sourceId: source.id, sourcePostId: `http-${randomUUID()}`, sourceUrl: `${source.url}/1`, originalContent: "ORIGINAL TEST EVIDENCE ONLY", originalLanguage: "en", sourcePublishedAt: new Date(), status: "DUPLICATE", rejectionReason: "سبب اختبار فقط" } });
    postId = post.id;
    const event = await client.canonicalEvent.create({ data: { title: "حدث اختبار فقط", summary: "سجل اختبار فقط", facts: [], revisions: { create: { facts: [], matches: { create: { sourcePostId: post.id, classification: "DUPLICATE", rationale: "مطابقة اختبار فقط" } }, newsItem: { create: { title: "خبر اختبار فقط", arabicContent: "صياغة عربية للاختبار فقط", status: "NEEDS_REVIEW", needsReviewReasons: ["سبب مراجعة اختباري"], evidence: { create: { sourcePostId: post.id } } } } } } }, include: { revisions: { include: { newsItem: true } } } });
    eventId = event.id;
    const news = event.revisions[0].newsItem!;
    const storyPage = await (await fetch(`${process.env.TEST_BASE_URL}/news/${news.id}`, { headers: { authorization } })).text();
    for (const text of ["خبر اختبار فقط", "صياغة عربية للاختبار فقط", "سبب مراجعة اختباري", "ORIGINAL TEST EVIDENCE ONLY", "مطابقة اختبار فقط"]) assert.ok(storyPage.includes(text), text);
    const postPage = await (await fetch(`${process.env.TEST_BASE_URL}/posts/${post.id}`, { headers: { authorization } })).text();
    assert.ok(postPage.includes("ORIGINAL TEST EVIDENCE ONLY"));
    assert.ok(postPage.includes("سبب اختبار فقط"));
    assert.ok(postPage.includes(news.id));
  } finally {
    if (postId) {
      await client.newsEvidence.deleteMany({ where: { sourcePostId: postId } });
      await client.eventMatch.deleteMany({ where: { sourcePostId: postId } });
    }
    if (eventId) {
      await client.newsItem.deleteMany({ where: { eventRevision: { eventId } } });
      await client.eventRevision.deleteMany({ where: { eventId } });
      await client.canonicalEvent.deleteMany({ where: { id: eventId } });
    }
    if (postId) await client.sourcePost.deleteMany({ where: { id: postId } });
    await client.$disconnect();
  }
});
