import { z } from "zod";

export const publishingModeSchema = z.enum(["REQUIRE_APPROVAL", "AUTO_PUBLISH"]);
export const sourceSchema = z.object({
  platform: z.enum(["TELEGRAM", "X"]),
  name: z.string().trim().min(1, "أدخل اسم المصدر").max(120),
  handle: z.string().trim().transform(value => value.replace(/^@/, "").toLowerCase()),
}).superRefine((value, ctx) => {
  const pattern = value.platform === "X" ? /^[a-z0-9_]{1,15}$/ : /^[a-z][a-z0-9_]{3,30}[a-z0-9]$/;
  if (!pattern.test(value.handle)) ctx.addIssue({ code: "custom", path: ["handle"], message: "أدخل معرّف الحساب الصحيح دون رابط" });
});

export function sourceUrl(platform: "TELEGRAM" | "X", handle: string) {
  return `https://${platform === "TELEGRAM" ? "t.me" : "x.com"}/${handle}`;
}

export const initialSources = [
  { platform: "TELEGRAM" as const, handle: "irna_arabic", name: "إرنا العربية" },
  { platform: "TELEGRAM" as const, handle: "isna94", name: "إيسنا" },
  { platform: "TELEGRAM" as const, handle: "alalamtv", name: "قناة العالم" },
  { platform: "X" as const, handle: "alarabiya", name: "العربية" },
  { platform: "X" as const, handle: "sputnik_ar", name: "سبوتنيك عربي" },
];

export function workerIsStale(lastSeenAt: Date, intervalMs: number, now = Date.now()) {
  return now - lastSeenAt.getTime() > Math.max(intervalMs * 3, 60_000);
}

export function retryDelay(attempt: number, retryAfterMs = 0) {
  return Math.max(retryAfterMs, Math.min(300_000, 1000 * 2 ** Math.max(0, attempt - 1)));
}

export function safeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["t.me", "x.com", "twitter.com"].includes(url.hostname) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
