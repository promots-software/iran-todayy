import test from "node:test";
import assert from "node:assert/strict";
import { authenticated } from "../src/lib/auth";
import { initialSources, publishingModeSchema, retryDelay, safeSourceUrl, sourceSchema, sourceUrl, workerIsStale } from "../src/lib/domain";

test("initial sources are valid, normalized and have official URLs", () => {
  assert.equal(initialSources.length, 5);
  for (const source of initialSources) {
    const parsed = sourceSchema.parse(source);
    assert.equal(parsed.handle, source.handle);
    assert.ok(safeSourceUrl(sourceUrl(source.platform, source.handle)));
  }
});
test("source handles normalize case and @, reject URLs and invalid accounts", () => {
  assert.equal(sourceSchema.parse({ platform: "X", handle: " @AlArabiya ", name: "العربية" }).handle, "alarabiya");
  for (const handle of ["https://x.com/name", "bad handle", "", "../../other", "a".repeat(16)]) {
    assert.equal(sourceSchema.safeParse({ platform: "X", handle, name: "test" }).success, false);
  }
  assert.equal(sourceSchema.safeParse({ platform: "TELEGRAM", handle: "abc", name: "test" }).success, false);
  assert.equal(sourceSchema.safeParse({ platform: "X", handle: "valid", name: " " }).success, false);
});
test("unsafe source links never become clickable", () => {
  for (const url of ["javascript:alert(1)", "http://x.com/name", "https://x.com.evil.test/name", "https://user:pass@t.me/name", "not a url"]) assert.equal(safeSourceUrl(url), null);
});
test("mode validation rejects arbitrary values", () => {
  assert.equal(publishingModeSchema.parse("REQUIRE_APPROVAL"), "REQUIRE_APPROVAL");
  assert.equal(publishingModeSchema.parse("AUTO_PUBLISH"), "AUTO_PUBLISH");
  assert.equal(publishingModeSchema.safeParse("anything").success, false);
});
test("authentication fails closed and supports colons in passwords", () => {
  const header = `Basic ${Buffer.from("admin:long:password").toString("base64")}`;
  assert.equal(authenticated(header, "admin", "long:password"), true);
  assert.equal(authenticated(header, "admin", "wrong"), false);
  assert.equal(authenticated(header, "", "long:password"), false);
  assert.equal(authenticated(null, "admin", "long:password"), false);
  assert.equal(authenticated("Bearer something", "admin", "long:password"), false);
  assert.equal(authenticated("Basic !!", "admin", "long:password"), false);
});
test("worker health becomes stale after grace period", () => {
  assert.equal(workerIsStale(new Date(0), 15000, 59_999), false);
  assert.equal(workerIsStale(new Date(0), 15000, 60_001), true);
  assert.equal(workerIsStale(new Date(0), 60000, 180_001), true);
});
test("retry delay increases, caps and respects upstream retry-after", () => {
  assert.equal(retryDelay(1), 1000);
  assert.equal(retryDelay(3), 4000);
  assert.equal(retryDelay(100), 300000);
  assert.equal(retryDelay(1, 600000), 600000);
});
