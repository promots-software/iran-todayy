import {requireUser} from '@/lib/session';
import {PageTitle} from '@/components/ui';
import {NewsFeed} from '@/components/news-feed';
import {HumanEditorialQueue} from '@/components/human-editorial-panel';
export default async function ApprovalsPage(){await requireUser();return <><PageTitle title="الموافقات" description="مراجعة القرار واعتماد النص ثم نشر النسخة المجمدة على الويب"/><NewsFeed mode="approval" where={{status:{in:['PENDING_APPROVAL','APPROVED','NEEDS_REVIEW']},error:null,validationStatus:{in:['PASSED','NEEDS_REVIEW']}}}/><HumanEditorialQueue approved/></>;}
