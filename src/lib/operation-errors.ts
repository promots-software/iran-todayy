const messages:Record<string,string>={
 STALE_CONTROL:'تغير الإعداد منذ فتح الصفحة. حدّث حالة الناشر ثم أكد اختيارك مجدداً.',
 REQUEST_ID_REUSED:'هذا التأكيد يخص تغييراً سابقاً. حدّث الصفحة ثم أكد الاختيار الجديد.',
 FORBIDDEN:'هذه العملية متاحة للمدير الأعلى النشط فقط.',
 AUTOMATIC_ENABLE_BLOCKED:'تعذر التفعيل: تحقق من نبضة الناشر وإعدادات Telegram وShadow Mode والإيقاف الطارئ وصلاحية التسليم.',
 AUTOMATIC_AUTHORIZATION_REQUIRED:'لا يوجد ترخيص تسليم آلي صالح. لا يمكن إنشاء ترخيص جديد من هذا التحكم.',
 AUTOMATIC_DISABLE_BLOCKED:'تغيرت حالة الترخيص. حدّث الصفحة قبل التعطيل.',
 DELIVERY_RECONCILIATION_REQUIRED:'توجد محاولة إرسال غير محسومة أو متعثرة؛ يلزم تسويتها قبل إعادة التفعيل.'
};
export function operationErrorMessage(error:unknown){
 return error instanceof Error&&messages[error.message]||'لم يُنفذ التغيير. حدّث الصفحة وتحقق من الصلاحية والتأكيد؛ لا تُعرض تفاصيل داخلية.';
}
