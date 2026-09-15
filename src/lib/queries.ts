import { db } from "./db";
import type { Prisma } from "@prisma/client";

export async function readDatabase<T>(query: () => Promise<T>): Promise<{ data: T; available: true } | { data: null; available: false }> {
  if (!process.env.DATABASE_URL) return { data: null, available: false };
  try { return { data: await query(), available: true }; }
  catch { return { data: null, available: false }; }
}

export const newsInclude = {
  eventRevision: { include: { event: true, matches: { include: { sourcePost: { include: { source: true } } } } } },
  evidence: { include: { sourcePost: { include: { source: true } } } },
  publication: { include: { attempts: { orderBy: { attempt: "desc" as const } } } },
  ruleSet: true,
} satisfies Prisma.NewsItemInclude;

export function overview() {
  return readDatabase(async () => {
    const [sources, items, pending, published, filtered, settings] = await Promise.all([
      db.source.count({ where: { deletedAt: null, enabled: true } }),
      db.newsItem.count(),
      db.newsItem.count({ where: { status: { in: ["PENDING_APPROVAL", "NEEDS_REVIEW"] } } }),
      db.publication.count({ where: { status: "SENT" } }),
      db.sourcePost.count({ where: { status: { in: ["FILTERED", "REJECTED", "DUPLICATE"] } } }),
      db.appSettings.findUnique({ where: { id: 1 } }),
    ]);
    return { sources, items, pending, published, filtered, mode: settings?.publishingMode ?? "REQUIRE_APPROVAL" };
  });
}
