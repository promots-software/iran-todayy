import Link from 'next/link';
import {AutoPublishAcknowledgement} from './auto-publish-acknowledgement';
import {randomUUID} from 'node:crypto';
import type {AppSettings,WorkerHeartbeat} from '@prisma/client';
import {automaticControlState} from '@/lib/telegram/auto-control';
import {OperationControl} from './operation-control';
export function AutoPublishPanel({settings,heartbeat,controls=false}:{controls?:boolean;settings:AppSettings|null;heartbeat:WorkerHeartbeat|null|undefined}){
 const s=automaticControlState(settings?.telegramAutoPolicy,settings?.publishingPaused??true,heartbeat);
 const reasons:Record<string,string>={NO_AUTHORIZATION:'لا يوجد ترخيص تسليم صالح',EMERGENCY_HOLD:'إيقاف النشر الطارئ فعال',PUBLISHER_UNAVAILABLE:'نبضة الناشر غير متاحة أو قديمة',DELIVERY_BLOCKED:'إعدادات الناشر أو حالته تمنع التسليم',AWAITING_PUBLISHER:'بانتظار تأكيد الناشر للتغيير',ENABLED:'الناشر جاهز للتسليم التلقائي',DISABLED:'التسليم التلقائي معطل'};
 return <section className="panel" aria-label="النشر التلقائي"><h2>النشر التلقائي</h2>
 <p><strong>{s.enabled?'مفعّل — ENABLED':'معطّل — DISABLED'}</strong> · {reasons[s.reason]}</p>
 <p>Telegram — Iran Today · <bdi>{s.policy?.destination??'غير محدد'}</bdi></p>
 <dl className="facts"><dt>تسليم Telegram لدى الناشر</dt><dd>{s.fresh&&typeof s.deliveryEnabled==='boolean'?(s.deliveryEnabled?'مفعّل':'معطّل'):'غير متحقق'}</dd><dt>Shadow Mode لدى الناشر</dt><dd>{s.fresh&&typeof s.shadowMode==='boolean'?(s.shadowMode?'يمنع التسليم':'لا يمنع التسليم'):'غير متحقق'}</dd><dt>الإيقاف الطارئ</dt><dd>{settings?.publishingPaused?'فعال':'غير فعال'}</dd><dt>تأكيد الناشر للإعداد الحالي</dt><dd>{s.fresh&&s.observed?'تم':'بانتظار التأكيد'}</dd></dl>
 <p>الأخبار الآلية المؤهلة من المصادر المصرّح بها تُرسل دون اعتماد يدوي عند التفعيل. الأخبار المحررة بشرياً تبقى بحاجة إلى اعتماد صريح. إيقاف النشر الطارئ مستقل.</p>
 {controls&&(s.canDisable||s.canEnable)&&<OperationControl key={s.expected} kind="AUTO_PUBLISH" target="1" value={s.canDisable?'false':'true'} expected={s.expected} requestId={randomUUID()} label={s.canDisable?'تعطيل النشر التلقائي':'تفعيل النشر التلقائي'}/>}
 {controls&&s.canAcknowledge&&<><p>أُوقف النشر بسبب عطل سابق. بعد معالجة السبب وتسوية المنشورات المتعثرة، يمكن إقرار المعالجة. يبقى النشر معطلاً حتى تفعّله صراحةً.</p><OperationControl key={`${s.expected}:${s.policy?.reason}`} kind="AUTO_PUBLISH_RECOVERY" target="1" value="ACKNOWLEDGE" expected={`${s.expected}:${s.policy?.reason}`} requestId={randomUUID()} label="أقرّ بمعالجة عطل النشر — إبقاء النشر معطلاً"/></>}
 {controls&&!s.canDisable&&!s.canEnable&&<p>التفعيل غير متاح حتى تتحقق صلاحية التسليم وجاهزية الناشر؛ لا يتجاوز هذا التحكم شروط الأمان.</p>}
 <AutoPublishAcknowledgement policyKey={s.expected} awaiting={s.fresh&&!s.observed}/>
 {!controls&&<p><Link href="/settings">إدارة النشر التلقائي من الإعدادات</Link></p>}
 <small>التعطيل يمنع المطالبات الجديدة، ولا يسحب طلب Telegram بدأ بالفعل.</small>
 </section>;
}
