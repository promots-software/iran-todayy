import {lockEditorialPublication} from './human-editorial-contract';
import {activationCursor} from './telegram/monitor';
import {syncAutomaticSources} from './telegram/source-authorization';
import { Prisma, PrismaClient } from "@prisma/client";
import { sourceSchema, sourceProcessingModeSchema, sourceUrl } from "./domain";


export async function saveSource(client: PrismaClient, input: unknown, actor: string) {
  const source = sourceSchema.parse(input);
  return client.$transaction(async tx => {
    await lockEditorialPublication(tx);
    const existing = await tx.source.findUnique({ where: { platform_handle: { platform: source.platform, handle: source.handle } } });
    if (existing && !existing.deletedAt) throw new Error("SOURCE_EXISTS");
    const data = { ...source, url: sourceUrl(source.platform, source.handle), enabled: true, deletedAt: null };
    const saved = existing
      ? await tx.source.update({ where: { id: existing.id }, data:{...data,...(source.platform==='TELEGRAM'?{cursor:activationCursor(existing.cursor)??Prisma.DbNull}:{})} })
      : await tx.source.create({ data });
    await tx.auditLog.create({ data: { actor, action: existing ? "SOURCE_RESTORED" : "SOURCE_CREATED", entityType: "Source", entityId: saved.id, message: `إضافة المصدر ${source.name}`, metadata: { platform: source.platform, handle: source.handle, previousMode: existing?.processingMode ?? null, processingMode: saved.processingMode } } });
    await syncAutomaticSources(tx,actor);
    return saved;
  });
}

export async function changeSource(client: PrismaClient, id: string, operation: "enable" | "disable" | "remove", actor: string) {
  return client.$transaction(async tx => {
    await lockEditorialPublication(tx);
    await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${id} FOR UPDATE`;
    const previous=await tx.source.findUnique({where:{id}});
    const activation=previous?.platform==='TELEGRAM'&&!previous.enabled&&operation==='enable'?{cursor:activationCursor(previous.cursor)??Prisma.DbNull}:{};
    const changed = await tx.source.updateMany({ where: { id, deletedAt: null }, data: operation === "remove" ? { deletedAt: new Date(), enabled: false } : { enabled: operation === "enable",...activation } });
    if (!changed.count) throw new Error("SOURCE_NOT_FOUND");
    await syncAutomaticSources(tx,actor);
    await tx.auditLog.create({ data: { actor, action: `SOURCE_${operation.toUpperCase()}`, entityType: "Source", entityId: id, message: operation === "remove" ? "إزالة المصدر مع الاحتفاظ بالسجل" : operation === "enable" ? "تفعيل المصدر" : "تعطيل المصدر" } });
  });
}

/** Retained for old callers: publishing policy is managed only by SUPER_ADMIN operations. */
export async function changeMode(_client: PrismaClient, _input: unknown, _actor: string) {
  void _client; void _input; void _actor;
  throw new Error('LEGACY_PUBLISHING_MODE_REMOVED');
}

/** Authenticated ADMIN action supplies actor; row lock preserves accurate old/new audit. */
export async function changeSourceProcessingMode(client: PrismaClient, id: string, input: unknown, actor: string) {
  const processingMode = sourceProcessingModeSchema.parse(input);
  if (!actor.trim()) throw new Error("AUTHENTICATION_REQUIRED");
  return client.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${id} FOR UPDATE`;
    const previous = await tx.source.findUnique({where:{id}});
    if (!previous || previous.deletedAt) throw new Error("SOURCE_NOT_FOUND");
    if (previous.processingMode === processingMode) return previous;
    const saved = await tx.source.update({where:{id},data:{processingMode}});
    await tx.auditLog.create({data:{actor,action:"SOURCE_PROCESSING_MODE_CHANGED",entityType:"Source",entityId:id,message:"تغيير طريقة معالجة المصدر",metadata:{previousMode:previous.processingMode,processingMode}}});
    return saved;
  });
}
