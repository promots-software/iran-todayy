import {requireUser} from '@/lib/session';
import {HumanEditorialQueue} from '@/components/human-editorial-panel';
import {UnresolvedPosts} from '@/components/post-feed';
import {PageTitle} from '@/components/ui';
import {NewsFeed} from '@/components/news-feed';
export default async function ReviewPage(){await requireUser();return <><PageTitle title="المراجعات" description="تحرير النص ومراجعة الأدلة واتخاذ قرار صورة النشر"/><UnresolvedPosts/><NewsFeed mode="review" where={{status:'NEEDS_REVIEW'}}/><HumanEditorialQueue/></>;}
