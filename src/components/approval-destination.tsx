export function ApprovalDestination(){
 return <label>وجهة الاعتماد<select name="target" required defaultValue=""><option value="" disabled>اختر الوجهة صراحة</option><option value="WEB">WEB — الموقع الإلكتروني</option><option value="TELEGRAM">Telegram — Iran Today</option></select><span className="muted">الاعتماد يجمّد النص لهذه الوجهة فقط؛ النشر يحتاج تأكيداً منفصلاً.</span></label>;
}
