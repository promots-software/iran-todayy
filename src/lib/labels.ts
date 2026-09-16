export const labels: Record<string, string> = {
  MATERIAL_UPDATE: "تطور جوهري", UNCERTAIN_MATCH: "مطابقة محتملة — تحتاج مراجعة",
  INGESTED: "تم الاستقبال", NORMALIZED: "تم الاستخراج", CLASSIFYING: "قيد التصنيف", DEDUPLICATING: "فحص التكرار",
  DRAFTING: "قيد التحرير", VALIDATING: "قيد التحقق", NEEDS_REVIEW: "يحتاج مراجعة", PENDING_APPROVAL: "بانتظار الموافقة",
  APPROVED: "معتمد", QUEUED: "في قائمة النشر", PUBLISHED: "منشور", FILTERED: "مستبعد", REJECTED: "مرفوض",
  DUPLICATE: "مكرر", FAILED: "فشل", NEW_EVENT: "حدث جديد", UPDATE: "تطور جوهري", UNCERTAIN: "غير مؤكد",
  NOT_RUN: "لم يبدأ التحقق", PASSED: "اجتاز التحقق", PENDING: "معلق", SENDING: "جارٍ الإرسال", SENT: "تم الإرسال",
  UNKNOWN: "نتيجة الإرسال غير مؤكدة", UNASSESSED: "لم يُقيّم", POLITICAL_NEWS: "خبر سياسي", IRRELEVANT: "غير ذي صلة",
  REQUIRE_APPROVAL: "موافقة يدوية", AUTO_PUBLISH: "نشر تلقائي", STARTING: "بدء التشغيل", IDLE: "خامل", BUSY: "مشغول",
  STOPPED: "متوقف", ERROR: "خطأ", INFO: "معلومة", WARN: "تنبيه", RETRY: "إعادة محاولة", RUNNING: "قيد التنفيذ", COMPLETED: "مكتمل",
};
export function label(value: string) { return labels[value] ?? value; }
export function date(value: Date | null | undefined) {
  return value ? new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Beirut" }).format(value) : "—";
}
