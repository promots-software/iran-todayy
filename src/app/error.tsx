"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="panel"><h1>تعذر عرض الصفحة</h1><p>حدث خطأ أثناء تحميل البيانات.</p><button onClick={reset}>إعادة المحاولة</button></section>; }
