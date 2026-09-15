import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { ModeForm } from "@/components/forms";
import { PageTitle, DatabaseNotice } from "@/components/ui";
export default async function SettingsPage() {
  const result = await readDatabase(() => db.appSettings.findUnique({ where: { id: 1 } }));
  return <><PageTitle title="الإعدادات" description="إعدادات النشر والسياسة التحريرية لغرفة الأخبار." />
    {result.available ? <ModeForm mode={result.data?.publishingMode ?? "REQUIRE_APPROVAL"} /> : <DatabaseNotice />}
    <section className="panel"><h2>المرجع التحريري</h2><span className="badge">بانتظار الوثائق</span><p>لم تُضف قواعد تحريرية. يلزم توفير «Publishing Prompt.pdf» و«مرجع المصطلحات - ايران الآن.pdf» قبل إعداد المحرك.</p><p className="muted">النموذج يدعم قواعد المصطلحات والسياق والإسناد والأسماء والألقاب والأرقام والتواريخ وحماية الاقتباسات والتحقق وأسباب المراجعة.</p></section>
    <section className="panel"><h2>وجهة النشر</h2><p>وجهة Telegram واحدة. لم يُربط أي حساب أو رمز وصول في هذه المرحلة.</p></section></>;
}
