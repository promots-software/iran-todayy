import type {PageProps} from '@/lib/dashboard-pagination';
import {requirePageAccess} from '@/lib/session';
import {HumanEditorialQueue} from '@/components/human-editorial-panel';
import {UnresolvedPosts} from '@/components/post-feed';
import {PageTitle} from '@/components/ui';
import {NewsFeed} from '@/components/news-feed';
export default async function ReviewPage({searchParams}:PageProps){await requirePageAccess('/review');const params=await searchParams;return <><PageTitle title="المراجعات" description="تحرير النص ومراجعة الأدلة واتخاذ قرار صورة النشر"/><UnresolvedPosts params={params}/><NewsFeed mode="review" params={params} path="/review"/><HumanEditorialQueue params={params}/></>;}
