"use client";
import { useActionState } from "react";
import { addSourceAction, sourceAction, modeAction } from "@/app/actions";
const initial = { ok: false, message: "" };

export function AddSourceForm() {
  const [state, action, pending] = useActionState(addSourceAction, initial);
  return <form action={action} className="panel form-panel">
    <div className="section-title"><h2>إضافة مصدر</h2><span className="muted">Telegram / X</span></div>
    <div className="form-grid">
      <label>اسم المصدر<input name="name" required maxLength={120} placeholder="مثال: وكالة أنباء" /></label>
      <label>المنصة<select name="platform"><option value="TELEGRAM">Telegram</option><option value="X">X</option></select></label>
      <label>معرّف الحساب<input name="handle" dir="ltr" required maxLength={33} placeholder="@username" /></label>
      <button disabled={pending} type="submit">{pending ? "جارٍ الحفظ…" : "+ إضافة المصدر"}</button>
    </div>
    {state.message && <p role="status" className={state.ok ? "success" : "error-text"}>{state.message}</p>}
    <p className="muted small">تُحفظ المصادر هنا. ربط المراقبة الفعلية يأتي في المرحلة الثانية.</p>
  </form>;
}

export function SourceControls({ id, enabled }: { id: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(sourceAction, initial);
  return <form action={action}>
    <input type="hidden" name="id" value={id} />
    <div className="controls">
      <button className="secondary" name="operation" value={enabled ? "disable" : "enable"} disabled={pending}>{enabled ? "تعطيل" : "تفعيل"}</button>
      <button className="danger" name="operation" value="remove" disabled={pending}>إزالة</button>
    </div>
    {state.message && <span role="status" className={state.ok ? "success small" : "error-text small"}>{state.message}</span>}
  </form>;
}

export function ModeForm({ mode }: { mode: "REQUIRE_APPROVAL" | "AUTO_PUBLISH" }) {
  const [state, action, pending] = useActionState(modeAction, initial);
  return <form action={action} className="panel form-panel">
    <h2>وضع النشر</h2>
    <fieldset>
      <legend className="muted">اختر آلية اعتماد الأخبار</legend>
      <label className="radio-card"><input type="radio" name="publishingMode" value="REQUIRE_APPROVAL" defaultChecked={mode === "REQUIRE_APPROVAL"} /><span><strong>الموافقة اليدوية</strong><small>كل خبر ينتظر الاعتماد قبل النشر. الوضع الافتراضي للاختبار.</small></span></label>
      <label className="radio-card"><input type="radio" name="publishingMode" value="AUTO_PUBLISH" defaultChecked={mode === "AUTO_PUBLISH"} /><span><strong>النشر التلقائي</strong><small>لاحقاً: الأخبار التي تجتاز التحقق فقط. أي شك تحريري يُحال إلى المراجعة.</small></span></label>
    </fieldset>
    <p className="notice">هذا الإعداد محفوظ للمراحل التالية. لا توجد خدمة إرسال أو معالجة أخبار في المرحلة الأولى.</p>
    <button disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}</button>
    {state.message && <p role="status" className={state.ok ? "success" : "error-text"}>{state.message}</p>}
  </form>;
}
