import {IngestionSource} from '@/components/ingestion-source';
import Link from 'next/link';
import {newsroomView} from '@/lib/newsroom-view';
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
import {renderPublicationText} from '@/lib/publication-text';
export const maxDuration=60;
export default async function NewsDetailPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{edit?:string}>}){
 const user=await requireUser();const query=await searchParams;const {id}=await params;const r=await readDatabase(()=>db.newsItem.findUnique({where:{id},include:{...newsInclude,humanDraft:true}}));if(!r.available)return <DatabaseNotice/>;const item=r.data;if(!item)notFound();
 const review=(item.validationResult as {review?:{code:string;detail?:string}[]}|null)?.review??[];
 let telegram=false;try{assertManualSendEnabled(process.env);readPublisherEnv();telegram=true;}catch{}
 const {ready,showEditor,showTechnical}=newsroomView(item,query.edit==='1',user.role);
 const editable=!item.publication&&['NEEDS_REVIEW','PENDING_APPROVAL','FAILED','REJECTED'].includes(item.status);
 const stalePreview=!!item.publication&&item.publication.contentSnapshot!==renderPublicationText(item.title,item.arabicContent??'');
 return <><PageTitle title={ready&&!showEditor?'معاينة الخبر':'تحرير الخبر'} description={ready&&!showEditor?'راجع النص واعتمده؛ التعديل اختياري.':'راجع المصدر، حرّر النص، ثم احفظ واعتمد الخبر.'}/>
 <section className="panel"><h2>الخبر الأصلي</h2>{item.evidence.map(({sourcePost:p})=><article key={p.id}><IngestionSource posts={[p]}/>{sourceHasMedia(p.metadata)&&<p className="notice">وسائط المصدر متاحة في المنشور الأصلي.</p>}<p className="original" dir="auto">{p.originalContent}</p><SourceLink url={p.sourceUrl}/></article>)}</section>
 <ReviewNotes reasons={[...review,...(item.error?[{code:item.error}]:[])]}/>
 {showTechnical&&<details className="panel"><summary>تفاصيل تقنية</summary><Badge value={item.status}/><h3>{item.title}</h3><p className="original">{item.arabicContent}</p><JsonView value={{error:item.error,validation:item.validationResult,facts:item.factualEvidence,quotes:item.protectedQuotes}}/></details>}
 {ready&&!showEditor&&<section className="panel"><h2>معاينة الخبر الجاهز</h2><p className="original">{renderPublicationText(item.title,item.arabicContent??'')}</p><Link href={`/news/${id}?edit=1`}>تعديل اختياري</Link></section>}
 {editable&&showEditor&&<HumanEditorialPanel kind="news" id={id} initialTitle={item.title} initialBody={item.arabicContent??''}/>}
 {!showEditor&&!item.humanDraft&&!item.publication&&!item.error&&['PASSED','NEEDS_REVIEW'].includes(item.validationStatus)&&['NEEDS_REVIEW','PENDING_APPROVAL'].includes(item.status)&&<section className="panel"><PublicationApproval id={id} digest={approvalDigest(item)} reviews={[...new Map(review.map(v=>[reviewKey(v),{key:reviewKey(v),label:reviewMessages([v])[0]??'مراجعة بشرية مطلوبة'}])).values()]}/></section>}
 {editable&&!item.humanDraft&&<RejectStory kind="news" id={id}/>}
 {item.publication&&<section className="panel"><h2>سجل النشر المجمد</h2><Badge value={item.publication.status}/><p className="original">{item.publication.contentSnapshot}</p><p>الوجهة: <bdi>{item.publication.destination}</bdi> · رسالة Telegram: {item.publication.telegramMessageId??'—'}</p></section>}
 {item.publication?.status==='PENDING'&&stalePreview&&<p role="alert">المحتوى المجمد يحتاج إلى إعادة مراجعة واعتماد قبل النشر؛ لم تُغيّر النسخة المعتمدة.</p>}
 {item.publication?.status==='PENDING'&&item.publication.attemptCount===0&&item.status==='APPROVED'&&<PublicationSend id={item.publication.id} digest={item.publication.idempotencyKey} destination={item.publication.destination} content={item.publication.contentSnapshot} telegramFormatSnapshot={item.publication.telegramFormatSnapshot} enabled={!stalePreview&&(item.publication.destination==='WEB'||telegram)}/>}
 </>;
}
