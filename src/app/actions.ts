"use server";

import { requireUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";

import { saveSource, changeSource, changeMode, changeSourceProcessingMode } from "@/lib/source-service";
import { saveSourceProfile } from "@/lib/processing/source-profile";
import {approvePublication,publishApprovedManually} from '@/lib/telegram/publisher';

import {lockEditorialPublication} from '@/lib/human-editorial-contract';
import {publishWeb} from '@/lib/web-publication';
import {validateImage} from '@/lib/publication-media';
import {saveHumanDraft,approveHumanDraft} from '@/lib/human-editorial';

export type ActionState = { ok: boolean; message: string };
async function actor(admin=false) {
 const user=await requireUser(admin);return `user:${user.id}`;
}
function failure(error: unknown): ActionState {
  if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "بيانات غير صالحة" };
  if (error instanceof Error && error.message === "SOURCE_EXISTS") return { ok: false, message: "هذا المصدر موجود بالفعل" };
  if (error instanceof Error && error.message === "SOURCE_NOT_FOUND") return { ok: false, message: "المصدر غير موجود. حدّث الصفحة." };
  return { ok: false, message: "تعذر حفظ التغيير. تحقق من اتصال قاعدة البيانات ثم حاول مجدداً." };
}
export async function addSourceAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await actor(true);
    await saveSource(db, { platform: form.get("platform"), handle: form.get("handle"), name: form.get("name"), processingMode: form.get("processingMode") ?? "NORMAL" }, user);
    revalidatePath("/", "layout");
    return { ok: true, message: "تمت إضافة المصدر" };
  } catch (error) { return failure(error); }
}
export async function sourceAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await actor(true);
    const id = z.string().min(1).max(100).parse(form.get("id"));
    const operation = z.enum(["enable", "disable", "remove"]).parse(form.get("operation"));
    await changeSource(db, id, operation, user);
    revalidatePath("/", "layout");
    return { ok: true, message: "تم حفظ التغيير" };
  } catch (error) { return failure(error); }
}
export async function modeAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await actor(true);
    await changeMode(db, form.get("publishingMode"), user);
    revalidatePath("/", "layout");
    return { ok: true, message: "تم حفظ وضع النشر. الموافقة اليدوية إلزامية والنشر التلقائي معطل." };
  } catch (error) { return failure(error); }
}
export async function sourceProfileAction(_:ActionState,form:FormData):Promise<ActionState> {
  try {
    const user=await actor(true);
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
  await approvePublication(db,{newsItemId,digest,resolutions:keys.map((key,i)=>({key,note:String(form.get(`resolution-${i}`)??'')}))},user,process.env,z.enum(['WEB','TELEGRAM']).parse(form.get('target')));
  revalidatePath(`/news/${newsItemId}`);
  return {ok:true,message:'حُفظ الاعتماد والمحتوى المحدد. لم تُرسل أي رسالة؛ الإرسال إجراء منفصل.'};
 }catch{return {ok:false,message:'تعذر الاعتماد. تحقق من اكتمال المراجعة، وثبات المسودة، وإعداد وجهة Telegram. أخطاء الأدلة تمنع الاعتماد.'};}
}
export async function publishPublicationAction(_:ActionState,form:FormData):Promise<ActionState>{
 try{
  const user=await actor();
  const publicationId=z.string().min(1).max(100).parse(form.get('publicationId'));
  const digest=z.string().regex(/^[a-f0-9]{64}$/).parse(form.get('digest'));
  const destination=z.string().regex(/^(WEB|-[1-9]\d*)$/).parse(form.get('destination'));
  if(destination==='WEB'){await publishWeb(db,{id:publicationId,digest,confirmed:form.get('confirmSend')==='on'},user);revalidatePath('/','layout');return {ok:true,message:'تم النشر على الويب. لم ترسل رسالة Telegram.'};}
  const outcome=await publishApprovedManually(db,{publicationId,digest,destination,confirmed:form.get('confirmSend')==='on'},user);
  revalidatePath('/', 'layout');
  return {ok:outcome.status==='SENT',message:outcome.status==='SENT'?'تم إرسال الرسالة وحفظ معرّف Telegram.':outcome.status==='NOT_SENT_ALREADY_CLAIMED'?'لم تُرسل رسالة جديدة. سبق حجز هذا المنشور؛ راجع الحالة ومعرّف الرسالة.':'توقف الإرسال. راجع الحالة والخطأ؛ لا تُعد الإرسال قبل التحقق اليدوي من Telegram.'};
 }catch{
  revalidatePath('/', 'layout');
  return {ok:false,message:'تعذر إتمام الإرسال. حدّث الصفحة وراجع حالة المنشور؛ قد يكون الإرسال قد بدأ. لا تنشئ نسخة أخرى. تحقق من الاعتماد والوجهة وإعداد النشر اليدوي.'};
 }
}

export async function saveHumanDraftAction(_:ActionState,form:FormData):Promise<ActionState>{
 try{
  const user=await actor();
  await saveHumanDraft(db,{kind:z.enum(['post','news']).parse(form.get('kind')),id:z.string().min(1).max(100).parse(form.get('id')),revision:z.coerce.number().int().min(0).parse(form.get('revision')),title:z.string().parse(form.get('title')),body:z.string().parse(form.get('body')),publicationImageId:z.string().max(100).nullable().parse(form.get('publicationImageId')||null),mediaDecision:form.get('mediaDecision')==='on'},user);
  revalidatePath('/', 'layout');return {ok:true,message:'حُفظت النسخة البشرية. يلزم اعتمادها صراحة؛ نتائج المعالجة الأصلية لم تتغير.'};
 }catch{return {ok:false,message:'تعذر الحفظ. حدّث الصفحة: قد تكون النسخة قد تغيرت أو بدأ إرسالها. يلزم عنوان ونص عربيان لا يتجاوز مجموعهما 4096 حرفاً.'};}
}
export async function approveHumanDraftAction(_:ActionState,form:FormData):Promise<ActionState>{
 try{
  const user=await actor();
  await approveHumanDraft(db,{id:z.string().min(1).max(100).parse(form.get('draftId')),digest:z.string().regex(/^[a-f0-9]{64}$/).parse(form.get('digest')),confirmed:form.get('confirmHuman')==='on',note:z.string().max(5000).parse(form.get('note')??'')},user,process.env,z.enum(['WEB','TELEGRAM']).parse(form.get('target')));
  revalidatePath('/', 'layout');return {ok:true,message:'اعتُمدت النسخة البشرية وجُمّدت المعاينة. لم تُرسل رسالة.'};
 }catch{return {ok:false,message:'تعذر الاعتماد. احفظ النص أولاً، وحدّث الصفحة، ووثّق المراجعة والمسؤولية البشرية صراحة.'};}
}

export async function uploadPublicationImage(_:ActionState,form:FormData):Promise<ActionState & {imageId?:string}>{
 try{const user=await actor();const file=form.get('image');if(!(file instanceof File))throw new Error('IMAGE_REQUIRED');if(file.size>2*1024*1024)throw new Error('IMAGE_SIZE');const bytes=Buffer.from(await file.arrayBuffer());const info=validateImage(bytes,file.type);
 const image=await db.$transaction(async tx=>{const image=await tx.publicationImage.create({data:{...info,bytes,createdBy:user}});await tx.auditLog.create({data:{actor:user,action:'PUBLICATION_IMAGE_UPLOADED',entityType:'PublicationImage',entityId:image.id,message:'إضافة صورة نشر اختيارية'}});return image;});return {ok:true,message:'أضيفت الصورة. احفظ التعديلات لربطها بالنسخة.',imageId:image.id};
 }catch{return {ok:false,message:'تعذر إضافة الصورة. استخدم PNG أو JPEG بحد أقصى 2 ميغابايت.'};}
}
export async function rejectEditorialAction(_:ActionState,form:FormData):Promise<ActionState>{
 try{const user=await actor();const kind=z.enum(['post','news']).parse(form.get('kind')),id=z.string().min(1).max(100).parse(form.get('id')),reason=z.string().trim().min(10).max(1000).parse(form.get('reason'));if(form.get('confirmed')!=='on')throw new Error('CONFIRM_REQUIRED');
 await db.$transaction(async tx=>{
  await lockEditorialPublication(tx);
  const draft=await tx.humanEditorialDraft.findFirst({where:kind==='news'?{newsItemId:id}:{sourcePostId:id},include:{publications:true}});
  if(draft?.publications.some(p=>p.status!=='CANCELLED'))throw new Error('PUBLICATION_LOCKED');
  if(kind==='news'){const n=await tx.newsItem.findUniqueOrThrow({where:{id},include:{publication:true}});if(n.publication||!['NEEDS_REVIEW','PENDING_APPROVAL','FAILED'].includes(n.status))throw new Error('NOT_REVIEWABLE');await tx.newsItem.update({where:{id},data:{status:'REJECTED',rejectionReason:[n.rejectionReason,`رفض بشري: ${reason}`].filter(Boolean).join('\n')}});}
  else{const p=await tx.sourcePost.findUniqueOrThrow({where:{id},include:{evidence:true}});if(p.evidence.length||!['NEEDS_REVIEW','FAILED'].includes(p.status))throw new Error('NOT_REVIEWABLE');await tx.sourcePost.update({where:{id},data:{status:'REJECTED',rejectionReason:[p.rejectionReason,`رفض بشري: ${reason}`].filter(Boolean).join('\n')}});}
  await tx.auditLog.create({data:{actor:user,action:'HUMAN_STORY_REJECTED',entityType:kind==='news'?'NewsItem':'SourcePost',entityId:id,message:'رفض الخبر من مسار المراجعة',metadata:{reason}}});
 });revalidatePath('/','layout');return {ok:true,message:'حُفظ الرفض دون حذف المصدر أو سجل المعالجة.'};
 }catch{return {ok:false,message:'تعذر الرفض. قد تكون الحالة تغيرت أو سبق اعتماد النشر.'};}
}

export async function sourceProcessingModeAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await actor(true);
    await changeSourceProcessingMode(db,z.string().min(1).max(100).parse(form.get("id")),form.get("processingMode"),user);
    revalidatePath("/sources");
    return {ok:true,message:"تم حفظ طريقة المعالجة"};
  } catch(error) {return failure(error);}
}
