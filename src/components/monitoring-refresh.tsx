'use client';
import {useEffect, useTransition} from 'react';
import {useRouter} from 'next/navigation';

export function MonitoringRefresh({live}: {live: boolean}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!live || pending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    }, 30000);
    return () => clearInterval(timer);
  }, [live, pending, router]);
  return <div className="section-title"><button type="button" className="secondary" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? 'جارٍ التحديث…' : 'تحديث الرصد'}</button>{live && <span className="small">تحديث تلقائي كل 30 ثانية أثناء عرض الصفحة</span>}</div>;
}
