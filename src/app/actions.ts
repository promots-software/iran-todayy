"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticated } from "@/lib/auth";
import { saveSource, changeSource, changeMode } from "@/lib/source-service";

export type ActionState = { ok: boolean; message: string };
async function actor() {
  if (!authenticated((await headers()).get("authorization"))) throw new Error("UNAUTHORIZED");
  return process.env.ADMIN_USERNAME!;
}
function failure(error: unknown): ActionState {
  if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "بيانات غير صالحة" };
  if (error instanceof Error && error.message === "SOURCE_EXISTS") return { ok: false, message: "هذا المصدر موجود بالفعل" };
  if (error instanceof Error && error.message === "SOURCE_NOT_FOUND") return { ok: false, message: "المصدر غير موجود. حدّث الصفحة." };
  return { ok: false, message: "تعذر حفظ التغيير. تحقق من اتصال قاعدة البيانات ثم حاول مجدداً." };
}
export async function addSourceAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    await saveSource(db, { platform: form.get("platform"), handle: form.get("handle"), name: form.get("name") }, user);
    revalidatePath("/", "layout");
    return { ok: true, message: "تمت إضافة المصدر" };
  } catch (error) { return failure(error); }
}
export async function sourceAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    const id = z.string().min(1).max(100).parse(form.get("id"));
    const operation = z.enum(["enable", "disable", "remove"]).parse(form.get("operation"));
    await changeSource(db, id, operation, user);
    revalidatePath("/", "layout");
    return { ok: true, message: "تم حفظ التغيير" };
  } catch (error) { return failure(error); }
}
export async function modeAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await actor();
    await changeMode(db, form.get("publishingMode"), user);
    revalidatePath("/", "layout");
    return { ok: true, message: "تم حفظ وضع النشر. النشر الفعلي غير مفعّل في المرحلة الأولى." };
  } catch (error) { return failure(error); }
}
