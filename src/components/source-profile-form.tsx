"use client";
import { useActionState } from "react";
import { sourceProfileAction } from "@/app/actions";
import { sourceProfileSchema, unknownProfile } from "@/lib/processing/contracts";
export function SourceProfileForm({id,value}:{id:string;value:unknown}) {
  const [state,action,pending]=useActionState(sourceProfileAction,{ok:false,message:""});
  const parsed=sourceProfileSchema.safeParse(value);const profile=parsed.success?parsed.data:unknownProfile;
  return <details><summary>توثيق وتصنيف المصدر</summary><form action={action} className="form-panel"><input type="hidden" name="id" value={id}/>
    <label>جهة المصدر<select name="classification" defaultValue={profile.classification}>{[["UNKNOWN","غير موثق"],["IRAN_OFFICIAL","إيراني رسمي"],["RESISTANCE","محور المقاومة"],["WESTERN","غربي"],["HEBREW","عبري"],["NEUTRAL","محايد"]].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
    <label>نوع المرجع<select name="authority" defaultValue={profile.authority}>{[["UNKNOWN","غير محدد"],["OFFICIAL","رسمي"],["AGENCY","وكالة"],["NEWSPAPER","صحيفة"],["ANALYST","محلل"]].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
    <label><input type="checkbox" name="verified" defaultChecked={profile.verified}/> تم التحقق من هوية المصدر</label>
    <label><input type="checkbox" name="flagged" defaultChecked={profile.flagged}/> مصدر معلّم يحتاج مراجعة</label>
    <label><input type="checkbox" name="approvedAnalyst" defaultChecked={profile.approvedAnalyst}/> محلل معتمد</label>
    <label>مرجع التحقق<input name="evidence" required defaultValue={profile.evidence} maxLength={20000}/></label>
    <button disabled={pending}>حفظ التصنيف</button>{state.message&&<p role="status">{state.message}</p>}
  </form></details>;
}
