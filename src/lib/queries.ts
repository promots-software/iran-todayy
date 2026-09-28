import {overviewData} from './overview-data';
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

export function overview() { return readDatabase(()=>overviewData(db)); }
