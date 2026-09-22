import type {PageProps} from '@/lib/dashboard-pagination';
import {requireUser} from '@/lib/session';
import {PageTitle} from '@/components/ui';
import {NewsFeed} from '@/components/news-feed';
import {HumanEditorialQueue} from '@/components/human-editorial-panel';
export default async function ApprovalsPage({searchParams}:PageProps){await requireUser();const params=await searchParams;return <><PageTitle title="الموافقات" description="مراجعة النص واختيار وجهة النشر واعتماد النسخة المجمدة؛ الإرسال إجراء منفصل"/><NewsFeed mode="approval" params={params} path="/approvals"/><HumanEditorialQueue approved params={params}/></>;}
