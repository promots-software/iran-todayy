"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticated } from "@/lib/auth";
import { saveSource, changeSource, changeMode } from "@/lib/source-service";
import { saveSourceProfile } from "@/lib/processing/source-profile";
import {approvePublication,publishApprovedManually} from '@/lib/telegram/publisher';

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
    return { ok: true, message: "تم حفظ وضع النشر. الموافقة اليدوية إلزامية والنشر التلقائي معطل." };
  } catch (error) { return failure(error); }
}
export async function sourceProfileAction(_:ActionState,form:FormData):Promise<ActionState> {
  try {
    const user=await actor();
    await saveSourceProfile(db,z.string().min(1).max(100).parse(form.get("id")),{verified:form.get("verified")==="on",flagged:form.get("flagged")==="on",approvedAnalyst:form.get("approvedAnalyst")==="on",classification:form.get("classification"),authority:form.get("authority"),evidence:form.get("evidence")},user);
    revalidatePath("/sources");return {ok:true,message:"تم توثيق التصنيف"};
  }catch(error){return failure(error);}
}
export async function approvePublicationAction(_:ActionState,form:FormData):Promise<ActionState>{
 try{
  const user=await actor();
  if(form.get('confirm')!=='on')return {ok:false,message:'يلزم تأكيد الموافقة اليدوية بعد مراجعة الأدلة.'};
  const newsItemId=z.string().min(1).max(100).parse(form.get('id'));
  const digest=z.string().regex(/^[a-f0-9]{64}$/).parse(form.get('digest'));
  const keys=form.getAll('reviewKey').map(v=>z.string().max(10000).parse(v));
  await approvePublication(db,{newsItemId,digest,resolutions:keys.map((key,i)=>({key,note:String(form.get(`resolution-${i}`)??'')}))},user);
  revalidatePath(`/news/${newsItemId}`);
  return {ok:true,message:'حُفظ الاعتماد والمحتوى المحدد. لم تُرسل أي رسالة؛ الإرسال إجراء منفصل.'};
 }catch{return {ok:false,message:'تعذر الاعتماد. تحقق من اكتمال المراجعة، وثبات المسودة، وإعداد وجهة Telegram. أخطاء الأدلة تمنع الاعتماد.'};}
}
export async function publishPublicationAction(_:ActionState,form:FormData):Promise<ActionState>{
 try{
  const user=await actor();
  const publicationId=z.string().min(1).max(100).parse(form.get('publicationId'));
  const digest=z.string().regex(/^[a-f0-9]{64}$/).parse(form.get('digest'));
  const destination=z.string().regex(/^-[1-9]\d*$/).parse(form.get('destination'));
  const outcome=await publishApprovedManually(db,{publicationId,digest,destination,confirmed:form.get('confirmSend')==='on'},user);
  revalidatePath('/', 'layout');
  return {ok:outcome.status==='SENT',message:outcome.status==='SENT'?'تم إرسال الرسالة وحفظ معرّف Telegram.':outcome.status==='NOT_SENT_ALREADY_CLAIMED'?'لم تُرسل رسالة جديدة. سبق حجز هذا المنشور؛ راجع الحالة ومعرّف الرسالة.':'توقف الإرسال. راجع الحالة والخطأ؛ لا تُعد الإرسال قبل التحقق اليدوي من Telegram.'};
 }catch{
  revalidatePath('/', 'layout');
  return {ok:false,message:'تعذر إتمام الإرسال. حدّث الصفحة وراجع حالة المنشور؛ قد يكون الإرسال قد بدأ. لا تنشئ نسخة أخرى. تحقق من الاعتماد والوجهة وإعداد النشر اليدوي.'};
 }
}
