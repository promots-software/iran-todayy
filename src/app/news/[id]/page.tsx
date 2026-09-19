import {requireUser} from '@/lib/session';
import {notFound} from 'next/navigation';
import {db} from '@/lib/db';
import {newsInclude,readDatabase} from '@/lib/queries';
import {PageTitle,DatabaseNotice,JsonView,SourceLink,Badge} from '@/components/ui';
import {ReviewNotes} from '@/components/review-notes';
import {HumanEditorialPanel} from '@/components/human-editorial-panel';
import {PublicationApproval} from '@/components/publication-approval';
import {PublicationSend} from '@/components/publication-send';
import {RejectStory} from '@/components/reject-story';
import {approvalDigest,reviewKey,assertManualSendEnabled,readPublisherEnv} from '@/lib/telegram/publisher';
import {reviewMessages} from '@/lib/processing/editorial-eligibility';
import {sourceHasMedia} from '@/lib/publication-media';
export const maxDuration=60;
export default async function NewsDetailPage({params}:{params:Promise<{id:string}>}){
 await requireUser();const {id}=await params;const r=await readDatabase(()=>db.newsItem.findUnique({where:{id},include:{...newsInclude,humanDraft:true}}));if(!r.available)return <DatabaseNotice/>;const item=r.data;if(!item)notFound();
 const review=(item.validationResult as {review?:{code:string;detail?:string}[]}|null)?.review??[];
 let telegram=false;try{assertManualSendEnabled(process.env);readPublisherEnv();telegram=true;}catch{}
 const editable=!item.publication&&['NEEDS_REVIEW','PENDING_APPROVAL','FAILED','REJECTED'].includes(item.status);
 return <><PageTitle title="مراجعة الخبر" description="راجع المصدر، حرّر النص، ثم احفظ واعتمد الخبر."/>
 <section className="panel"><h2>الخبر الأصلي</h2>{item.evidence.map(({sourcePost:p})=><article key={p.id}><h3>{p.source.name}</h3>{sourceHasMedia(p.metadata)&&<p className="notice">وسائط المصدر متاحة في المنشور الأصلي.</p>}<p className="original" dir="auto">{p.originalContent}</p><SourceLink url={p.sourceUrl}/></article>)}</section>
 <ReviewNotes reasons={[...review,...(item.error?[{code:item.error}]:[])]}/>
 <details className="panel"><summary>تفاصيل المعالجة</summary><Badge value={item.status}/><h3>{item.title}</h3><p className="original">{item.arabicContent}</p><JsonView value={{error:item.error,validation:item.validationResult,facts:item.factualEvidence,quotes:item.protectedQuotes}}/></details>
 {editable&&<HumanEditorialPanel kind="news" id={id} initialTitle={item.title} initialBody={item.arabicContent??''}/>}
 {!item.humanDraft&&!item.publication&&!item.error&&['PASSED','NEEDS_REVIEW'].includes(item.validationStatus)&&['NEEDS_REVIEW','PENDING_APPROVAL'].includes(item.status)&&<details className="panel"><summary>اعتماد النص المقترح دون تعديل</summary><PublicationApproval id={id} digest={approvalDigest(item)} reviews={[...new Map(review.map(v=>[reviewKey(v),{key:reviewKey(v),label:reviewMessages([v])[0]??'مراجعة بشرية مطلوبة'}])).values()]}/></details>}
 {editable&&!item.humanDraft&&<RejectStory kind="news" id={id}/>}
 {item.publication&&<section className="panel"><h2>سجل النشر المجمد</h2><Badge value={item.publication.status}/><p className="original">{item.publication.contentSnapshot}</p><p>الوجهة: <bdi>{item.publication.destination}</bdi> · رسالة Telegram: {item.publication.telegramMessageId??'—'}</p></section>}
 {item.publication?.status==='PENDING'&&item.publication.attemptCount===0&&item.status==='APPROVED'&&<PublicationSend id={item.publication.id} digest={item.publication.idempotencyKey} destination={item.publication.destination} content={item.publication.contentSnapshot} enabled={item.publication.destination==='WEB'||telegram}/>}
 </>;
}
