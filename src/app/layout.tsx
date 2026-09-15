import type { Metadata } from "next";
import { Navigation } from "@/components/navigation";
import "./globals.css";
export const metadata: Metadata = { title: { default: "إيران اليوم | غرفة الأخبار", template: "%s | إيران اليوم" }, description: "لوحة متابعة وتحرير الأخبار السياسية", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body><a className="skip" href="#main">انتقل إلى المحتوى</a><div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">إ</span><div><strong>إيران اليوم</strong><span dir="ltr">IRAN TODAY</span></div></div><div className="sidebar-caption">لوحة التحكم</div><Navigation /><div className="sidebar-bottom"><span className="dot" /> المرحلة الأولى<span>تأسيس غرفة الأخبار</span></div></aside>
    <div className="workspace"><div className="topbar"><span>متابعة الأخبار السياسية</span><span className="topbar-note">مساحة تحرير واحدة <span className="avatar">إي</span></span></div><main id="main">{children}</main><footer>إيران اليوم <span>•</span> جميع الأوقات بتوقيت بيروت</footer></div>
  </div></body></html>;
}
