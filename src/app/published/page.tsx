import {HumanEditorialQueue} from '@/components/human-editorial-panel';
import { PageTitle } from "@/components/ui";
import { NewsFeed } from "@/components/news-feed";
export default function PublishedPage() { return <><PageTitle title="الأخبار المنشورة" description="سجل الأخبار التي تأكد إرسالها إلى Telegram." /><section className="panel"><NewsFeed where={{ publication: { is: { status: "SENT" } } }} /></section><HumanEditorialQueue published/></>; }
