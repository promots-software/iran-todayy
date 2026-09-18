import { Prisma, PrismaClient } from "@prisma/client";
import { sourceSchema, sourceUrl, publishingModeSchema } from "./domain";
import { assertApprovalMode } from "./processing/shadow";

export async function saveSource(client: PrismaClient, input: unknown, actor: string) {
  const source = sourceSchema.parse(input);
  return client.$transaction(async tx => {
    const existing = await tx.source.findUnique({ where: { platform_handle: { platform: source.platform, handle: source.handle } } });
    if (existing && !existing.deletedAt) throw new Error("SOURCE_EXISTS");
    const data = { ...source, url: sourceUrl(source.platform, source.handle), enabled: true, deletedAt: null };
    const saved = existing
      ? await tx.source.update({ where: { id: existing.id }, data })
      : await tx.source.create({ data });
    await tx.auditLog.create({ data: { actor, action: existing ? "SOURCE_RESTORED" : "SOURCE_CREATED", entityType: "Source", entityId: saved.id, message: `إضافة المصدر ${source.name}`, metadata: { platform: source.platform, handle: source.handle } } });
    return saved;
  });
}

export async function changeSource(client: PrismaClient, id: string, operation: "enable" | "disable" | "remove", actor: string) {
  return client.$transaction(async tx => {
    const changed = await tx.source.updateMany({ where: { id, deletedAt: null }, data: operation === "remove" ? { deletedAt: new Date(), enabled: false } : { enabled: operation === "enable" } });
    if (!changed.count) throw new Error("SOURCE_NOT_FOUND");
    await tx.auditLog.create({ data: { actor, action: `SOURCE_${operation.toUpperCase()}`, entityType: "Source", entityId: id, message: operation === "remove" ? "إزالة المصدر مع الاحتفاظ بالسجل" : operation === "enable" ? "تفعيل المصدر" : "تعطيل المصدر" } });
  });
}

export async function changeMode(client: PrismaClient, input: unknown, actor: string) {
  const publishingMode = publishingModeSchema.parse(input);
  assertApprovalMode(publishingMode);
  return client.$transaction(async tx => {
    const previous = await tx.appSettings.findUnique({ where: { id: 1 } });
    await tx.appSettings.upsert({ where: { id: 1 }, create: { id: 1, publishingMode }, update: { publishingMode } });
    await tx.auditLog.create({ data: { actor, action: "PUBLISHING_MODE_CHANGED", entityType: "AppSettings", entityId: "1", message: "تغيير وضع النشر", metadata: { previous: previous?.publishingMode ?? "REQUIRE_APPROVAL", publishingMode } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
