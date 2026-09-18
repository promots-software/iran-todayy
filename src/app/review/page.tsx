import {HumanEditorialQueue} from '@/components/human-editorial-panel';
import { UnresolvedPosts } from "@/components/post-feed";
import { PageTitle } from "@/components/ui";
import { NewsFeed } from "@/components/news-feed";
export default function ReviewPage() { return <><PageTitle title="الموافقات والمراجعة" description="الأخبار بانتظار الموافقة، والمواد التي تحتاج تدقيقاً تحريرياً." /><p className="notice">راجع الأدلة واعتمد النص في صفحة الخبر، ثم أكد إرسال النص المجمّد يدوياً. النشر التلقائي معطل.</p><section className="panel"><h2>مراجعة تحريرية وأخطاء المعالجة</h2><UnresolvedPosts /><NewsFeed where={{ status: "NEEDS_REVIEW" }} /></section><section className="panel"><h2>جاهز للنشر — ينتظر الموافقة اليدوية</h2><NewsFeed where={{ status: "PENDING_APPROVAL" }} /></section><section className="panel"><h2>معتمد — متابعة الإرسال</h2><NewsFeed where={{ status: "APPROVED" }} /></section><HumanEditorialQueue/></>; }
