import Link from 'next/link';
import {PublishingModeForm} from './publishing-mode-form';
import {AutoPublishAcknowledgement} from './auto-publish-acknowledgement';
import {randomUUID} from 'node:crypto';
import type {AppSettings,WorkerHeartbeat} from '@prisma/client';
import {automaticControlState} from '@/lib/telegram/auto-control';
import {OperationControl} from './operation-control';
export function AutoPublishPanel({settings,heartbeat,controls=false,recovery=false}:{controls?:boolean;recovery?:boolean;settings:AppSettings|null;heartbeat:WorkerHeartbeat|null|undefined}){
 const s=automaticControlState(settings?.telegramAutoPolicy,settings?.publishingPaused??true,heartbeat);
 const reasons:Record<string,string>={COOLDOWN:'فترة انتظار قبل فحص التعافي',READINESS_CHECK:'جارٍ فحص جاهزية Telegram',WORKER_UNAVAILABLE:'العامل غير جاهز أو نبضته قديمة',UNRESOLVED_DELIVERY:'توجد مطالبة إرسال غير محسومة وغير معزولة',TELEGRAM_READINESS_UNAVAILABLE:'تعذر التحقق من Telegram',TELEGRAM_POST_PERMISSION_UNVERIFIED:'صلاحية النشر في القناة غير مؤكدة',TELEGRAM_IDENTITY_UNVERIFIED:'هوية البوت غير مؤكدة',TELEGRAM_CONFIG_INVALID:'إعداد Telegram غير صالح',SYSTEMIC_DELIVERY_FAILURE:'عطل تسليم متكرر أو مستمر؛ يلزم تدخل المشغّل',PUBLISHER_ERROR:'الناشر يبلغ عن عطل',AUTO_CAPABILITY_OFF:'قدرة النشر التلقائي لدى العامل معطلة',SHADOW_MODE_BLOCKED:'وضع Shadow يمنع التسليم',APPROVAL_CAPABILITY_MISMATCH:'إعداد الاعتماد لدى العامل غير مطابق',TELEGRAM_DELIVERY_OFF:'قدرة تسليم Telegram معطلة',DESTINATION_MISMATCH:'وجهة العامل لا تطابق الوجهة المصرّح بها',NO_AUTHORIZATION:'لا يوجد ترخيص تسليم صالح',EMERGENCY_HOLD:'إيقاف النشر الطارئ فعال',PUBLISHER_UNAVAILABLE:'نبضة الناشر غير متاحة أو قديمة',DELIVERY_BLOCKED:'إعدادات الناشر أو حالته تمنع التسليم',AWAITING_PUBLISHER:'بانتظار تأكيد الناشر للتغيير',ENABLED:'الناشر جاهز للتسليم التلقائي',DISABLED:'التسليم التلقائي معطل'};
 const labels:Record<string,string>={ACTIVE:'النشر التلقائي يعمل',TEMPORARY_RECOVERY:'توقف مؤقت — سيحاول النظام استئناف النشر تلقائياً',SYSTEMIC_SAFETY_STOP:'توقف أمان — يتطلب مراجعة المشغّل',OPERATOR_DISABLED:'النشر اليدوي — اختاره المشغّل',EMERGENCY_PAUSE:'إيقاف النشر الطارئ'};
 return <section className="panel" aria-label="النشر التلقائي"><h2>النشر التلقائي</h2>
 <p><strong>{labels[s.presentation]}</strong></p><p>جاهزية التسليم: {s.enabled?'مفعّل':reasons[s.reason]??s.reason}</p>
 {s.policy?.recovery&&s.presentation!=='ACTIVE'&&s.presentation!=='OPERATOR_DISABLED'&&<dl className="facts"><dt>المنشور المتعثر (لن يُعاد إرساله)</dt><dd><bdi>{s.policy.recovery.publicationId}</bdi></dd><dt>وقت التوقف</dt><dd><bdi>{s.policy.recovery.startedAt}</bdi></dd><dt>الفحص التالي</dt><dd><bdi>{s.policy.recovery.nextCheckAt}</bdi></dd><dt>سبب الانتظار / الإيقاف</dt><dd>{s.policy.recovery.blocker}</dd><dt>تصنيف عطل النقل</dt><dd>{s.policy.recovery.diagnostic?.errorCategory??'غير متاح'}</dd><dt>مرحلة النقل</dt><dd>{s.policy.recovery.diagnostic?.phase??'غير متاحة'}</dd><dt>حالة التعافي</dt><dd>{s.policy.recovery.circuit}</dd><dt>فحوص التعافي</dt><dd>{s.policy.recovery.checks}</dd></dl>}
 <p>Telegram — Iran Today · <bdi>{s.policy?.destination??'غير محدد'}</bdi></p>
 <dl className="facts"><dt>تسليم Telegram لدى الناشر</dt><dd>{s.fresh&&typeof s.deliveryEnabled==='boolean'?(s.deliveryEnabled?'مفعّل':'معطّل'):'غير متحقق'}</dd><dt>Shadow Mode لدى الناشر</dt><dd>{s.fresh&&typeof s.shadowMode==='boolean'?(s.shadowMode?'يمنع التسليم':'لا يمنع التسليم'):'غير متحقق'}</dd><dt>الإيقاف الطارئ</dt><dd>{settings?.publishingPaused?'فعال':'غير فعال'}</dd><dt>تأكيد الناشر للإعداد الحالي</dt><dd>{s.fresh&&s.observed?'تم':'بانتظار التأكيد'}</dd></dl>
 <p>الأخبار الآلية المؤهلة من المصادر المصرّح بها تُرسل دون اعتماد يدوي عند التفعيل. الأخبار المحررة بشرياً تبقى بحاجة إلى اعتماد صريح. إيقاف النشر الطارئ مستقل.</p>
 {controls&&(s.policy?.state==='ACTIVE'||s.recovering||s.policy?.reason==='OPERATOR_DISABLED')&&<PublishingModeForm key={s.expected} automatic={s.policy?.state==='ACTIVE'||s.recovering} canEnable={s.canEnable} canDisable={s.canDisable} expected={s.expected} requestId={randomUUID()}/>}
 {controls&&recovery&&s.canAcknowledge&&<><p>أُوقف النشر بسبب عطل سابق. بعد معالجة السبب وتسوية المنشورات المتعثرة، يمكن إقرار المعالجة. يبقى النشر معطلاً حتى تفعّله صراحةً.</p><OperationControl key={`${s.expected}:${s.policy?.reason}`} kind="AUTO_PUBLISH_RECOVERY" target="1" value="ACKNOWLEDGE" expected={`${s.expected}:${s.policy?.reason}`} requestId={randomUUID()} label="أقرّ بمعالجة عطل النشر — إبقاء النشر معطلاً"/></>}
 {controls&&!s.canDisable&&!s.canEnable&&<p>سبب عدم توفر التفعيل: {reasons[s.reason]??s.reason}. لا يتجاوز هذا التحكم شروط الأمان.</p>}
 <AutoPublishAcknowledgement policyKey={s.expected} awaiting={s.fresh&&!s.observed}/>
 {!controls&&<p><Link href="/settings">إدارة النشر التلقائي من الإعدادات</Link></p>}
 <small>التعطيل يمنع المطالبات الجديدة، ولا يسحب طلب Telegram بدأ بالفعل.</small>
 </section>;
}
