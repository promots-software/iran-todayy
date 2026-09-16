"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const routes = [
  ["/", "نظرة عامة", "◫"], ["/sources", "المصادر", "◎"], ["/review", "الموافقات والمراجعة", "◷"],
  ["/published", "الأخبار المنشورة", "↗"], ["/filtered", "المستبعد والمرفوض", "⊘"],
  ["/events", "مطابقة الأحداث", "⇄"],
  ["/logs", "سجل العمليات", "≡"], ["/settings", "الإعدادات", "⚙"], ["/system", "حالة النظام", "◇"],
];
export function Navigation() {
  const path = usePathname();
  return <nav aria-label="القائمة الرئيسية">{routes.map(([href, title, icon]) => <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className={path === href ? "nav-link active" : "nav-link"}><span aria-hidden="true">{icon}</span>{title}</Link>)}</nav>;
}
