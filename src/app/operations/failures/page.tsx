import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {requireSuperAdmin} from '@/lib/session';
import {db} from '@/lib/db';
import {safeCode,failureCategory} from '@/lib/operations';
import {safeRetryCodes} from '@/lib/operations-controls';
import {OperationControl} from '@/components/operation-control';
import {PageTitle,Badge} from '@/components/ui';
export default async function Failures({searchParams}:{searchParams:Promise<{reason?:string;stage?:string;category?:string}>}){
 await requireSuperAdmin();const p=await searchParams;const reason=p.reason&&/^[A-Z0-9_]{1,100}$/.test(p.reason)?p.reason:undefined;const stage=p.stage&&/^[A-Za-z0-9_]{1,100}$/.test(p.stage)?p.stage:undefined;
 const jobs=await db.processingJob.findMany({where:{status:{in:['RETRY','FAILED']},...(reason?{lastError:reason}:{}),...(stage?{stage}:{})},orderBy:{updatedAt:'desc'},take:100});
 return <><PageTitle title="الأخبار المتعثرة" description="آخر 100 مهمة مطابقة. لا يعاد تشغيل أي خبر عند فتح الصفحة."/><form className="filters"><label>رمز السبب<input name="reason" defaultValue={reason}/></label><label>المرحلة<input name="stage" defaultValue={stage}/></label><label>الفئة<select name="category" defaultValue={p.category??''}><option value="">الكل</option>{['provider','cost','source','validation','database','technical'].map(c=><option key={c} value={c}>{c}</option>)}</select></label><button>تصفية</button></form>{jobs.filter(j=>!p.category||failureCategory(j.lastError??'')===p.category).map(j=><article className="panel" key={j.id}><Link href={`/operations/posts/${j.sourcePostId}`}>فحص الخبر {j.sourcePostId}</Link><p><Badge value={j.status}/> · {failureCategory(j.lastError??'')} · {j.stage} · {safeCode(j.lastError)} · محاولات {j.attemptCount}</p>{j.status==='FAILED'&&safeRetryCodes.some(c=>c===j.lastError)?<OperationControl requestId={randomUUID()} kind="RETRY" target={j.id} value="RETRY" expected={j.updatedAt.toISOString()} label="إعادة محاولة تقنية آمنة؛ يعاد التحقق قبل التنفيذ"/>:<p>انتظار مجدول أو مراجعة/تسوية لازمة؛ لا تتوفر إعادة آلية لهذا السبب.</p>}</article>)}</>;
}
