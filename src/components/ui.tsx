import Link from "next/link";
import { label } from "@/lib/labels";
import { safeSourceUrl } from "@/lib/domain";
export function Badge({ value }: { value: string }) {
  return <span className={`badge ${["SENT", "PUBLISHED", "PASSED"].includes(value) ? "green" : ["FAILED", "ERROR", "REJECTED"].includes(value) ? "red" : ""}`}>{label(value)}</span>;
}
export function PageTitle({ title, description, eyebrow = "غرفة الأخبار" }: { title: string; description: string; eyebrow?: string }) {
  return <header className="page-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>;
}
export function DatabaseNotice() {
  return <div className="notice" role="alert"><strong>قاعدة البيانات غير متاحة</strong><p>تحقق من إعداد الاتصال وتطبيق ترحيلات قاعدة البيانات. لا تُعرض بيانات تجريبية، ولا يمكن حفظ التغييرات حالياً.</p></div>;
}
export function EmptyState({ title = "لا توجد أخبار بعد", text = "ستظهر الأخبار هنا بعد ربط المصادر وتفعيل المعالجة في المرحلة الثانية." }: { title?: string; text?: string }) {
  return <div className="empty"><span className="empty-icon" aria-hidden="true">◎</span><h3>{title}</h3><p>{text}</p><Link href="/sources" className="text-link">إدارة المصادر ←</Link></div>;
}
export function SourceLink({ url, children }: { url: string; children?: React.ReactNode }) {
  const safe = safeSourceUrl(url);
  return safe ? <a className="text-link" href={safe} target="_blank" rel="noopener noreferrer">{children ?? "فتح المنشور الأصلي ↗"}</a> : <span className="muted">رابط المصدر غير صالح</span>;
}
export function JsonView({ value }: { value: unknown }) {
  return value == null ? <span className="muted">لا توجد بيانات</span> : <pre dir="ltr">{JSON.stringify(value, null, 2)}</pre>;
}
