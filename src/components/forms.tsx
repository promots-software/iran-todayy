"use client";
import {SourceProcessingModeControl} from "./source-processing-mode";
import { useActionState } from "react";
import { addSourceAction, sourceAction } from "@/app/actions";
const initial = { ok: false, message: "" };

export function AddSourceForm() {
  const [state, action, pending] = useActionState(addSourceAction, initial);
  return <form action={action} className="panel form-panel">
    <div className="section-title"><h2>إضافة مصدر</h2><span className="muted">Telegram / X</span></div>
    <div className="form-grid">
      <label>اسم المصدر<input name="name" required maxLength={120} placeholder="مثال: وكالة أنباء" /></label>
      <label>المنصة<select name="platform"><option value="TELEGRAM">Telegram</option><option value="X">X</option></select></label>
      <label>معرّف الحساب<input name="handle" dir="ltr" required maxLength={33} placeholder="@username" /></label>
      <SourceProcessingModeControl/>
      <button disabled={pending} type="submit">{pending ? "جارٍ الحفظ…" : "+ إضافة المصدر"}</button>
    </div>
    {state.message && <p role="status" className={state.ok ? "success" : "error-text"}>{state.message}</p>}
    <p className="muted small">تفعيل المصدر لا يثبت اتصال الموصل. حالة Telegram متاحة في العمليات؛ إعداد X لا يعني تفعيل استقباله.</p>
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
