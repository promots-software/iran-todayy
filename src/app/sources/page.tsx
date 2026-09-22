import {autoPolicySchema} from '@/lib/telegram/auto-policy';
import {SourceProcessingModeForm} from "@/components/source-processing-mode";
import {requireUser} from "@/lib/session";
import { SourceProfileForm } from "@/components/source-profile-form";
import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { date } from "@/lib/labels";
import { AddSourceForm, SourceControls } from "@/components/forms";
import { PageTitle, DatabaseNotice, SourceLink, EmptyState } from "@/components/ui";
export default async function SourcesPage() {
 await requireUser(true);
  const result = await readDatabase(() => db.source.findMany({ where: { deletedAt: null }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] }));
  const settings=await readDatabase(()=>db.appSettings.findUnique({where:{id:1},select:{telegramAutoPolicy:true}}));
  const policy=autoPolicySchema.safeParse(settings.available?settings.data?.telegramAutoPolicy:null);
  return <><PageTitle title="المصادر" description="أضف حسابات Telegram وX، وتحكّم في تفعيلها من هنا." />
    {result.available ? <><AddSourceForm /><section className="panel"><div className="section-title"><h2>قائمة المصادر</h2><span className="muted">{result.data.length.toLocaleString("ar")} مصادر</span></div>
      {!result.data.length ? <EmptyState title="لا توجد مصادر" text="أضف مصدراً أعلاه أو شغّل تهيئة المصادر الأولية." /> : <div className="table-scroll"><table><thead><tr><th>المصدر</th><th>المنصة</th><th>الحالة</th><th>آخر فحص</th><th>الإجراءات</th></tr></thead><tbody>{result.data.map(source => <tr key={source.id}><td><strong>{source.name}</strong><div dir="ltr" className="handle"><SourceLink url={source.url}>@{source.handle}</SourceLink></div>{source.lastError && <p className="error-text small">{source.lastError}</p>}</td><td><span className="platform">{source.platform === "TELEGRAM" ? "Telegram" : "X"}</span></td><td><span className={`badge ${source.enabled ? "green" : ""}`}>{source.enabled ? "مفعّل" : "معطّل"}</span>{source.enabled&&source.platform==="TELEGRAM"&&<p className="small">{policy.success&&policy.data.sourceIds.includes(source.id)?"مصرّح للنشر التلقائي عند تفعيل النشر التلقائي — للأخبار الجديدة المؤهلة فقط":"صلاحية التسليم الآلي غير مهيأة بعد"}</p>}</td><td>{date(source.lastPollAt)}</td><td><SourceControls id={source.id} enabled={source.enabled} /><SourceProcessingModeForm id={source.id} value={source.processingMode}/><SourceProfileForm id={source.id} value={source.editorialProfile}/></td></tr>)}</tbody></table></div>}
      <p className="muted small">إزالة المصدر تحفظ المنشورات السابقة وسجل التدقيق. إعادة إضافته تستعيد السجل نفسه.</p></section></> : <DatabaseNotice />}</>;
}
