import {reviewPrefill} from '@/lib/processing/available-draft';
import {requireUser} from '@/lib/session';
import {notFound} from 'next/navigation';
import Link from 'next/link';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {PageTitle,DatabaseNotice,JsonView,SourceLink} from '@/components/ui';
import {HumanEditorialPanel} from '@/components/human-editorial-panel';
import {sourceHasMedia} from '@/lib/publication-media';
import {ReviewNotes} from '@/components/review-notes';
import {RejectStory} from '@/components/reject-story';
export const maxDuration=60;
export default async function PostPage({params}:{params:Promise<{id:string}>}){const user=await requireUser();const {id}=await params;const r=await readDatabase(()=>db.sourcePost.findUnique({where:{id},include:{source:true,evidence:true}}));if(!r.available)return <DatabaseNotice/>;const p=r.data;if(!p)notFound();const proposal=reviewPrefill(p.processingResult);return <><PageTitle title="مراجعة الخبر" description={p.source.name}/><section className="panel"><h2>الخبر الأصلي</h2><h3>{p.source.name}</h3>{sourceHasMedia(p.metadata)&&<p className="notice">وسائط المصدر متاحة في المنشور الأصلي.</p>}<p className="original" dir="auto">{p.originalContent}</p><SourceLink url={p.sourceUrl}/></section><ReviewNotes reasons={p.error?[{code:p.error}]:[]}/>{user.role!=='EDITOR'&&<details className="panel"><summary>تفاصيل تقنية</summary><JsonView value={{error:p.error,rejectionReason:p.rejectionReason,processingResult:p.processingResult,relevanceResult:p.relevanceResult}}/></details>}{!p.evidence.length&&['NEEDS_REVIEW','FAILED','REJECTED'].includes(p.status)&&<>{proposal&&<p className="notice">مسودة مقترحة غير معتمدة — تحتاج إلى مراجعة بشرية.</p>}<HumanEditorialPanel kind="post" id={id} initialTitle={proposal?.title??''} initialBody={proposal?.body??''}/><RejectStory kind="post" id={id}/></>}{p.evidence.map(e=><Link key={e.newsItemId} href={`/news/${e.newsItemId}`}>مراجعة الخبر المرتبط</Link>)}</>;}
