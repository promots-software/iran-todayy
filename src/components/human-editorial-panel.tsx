import {IngestionSource} from '@/components/ingestion-source';
import {requireUser} from '@/lib/session';
import {pageNumber,pageWindow,type PageParams} from '@/lib/dashboard-pagination';
import {Pagination} from './pagination';
import Image from 'next/image';
import Link from 'next/link';
import {db} from '@/lib/db';
import {humanDigest} from '@/lib/human-editorial-contract';
import {renderPublicationText} from '@/lib/publication-text';
import {assertManualSendEnabled,readPublisherEnv} from '@/lib/telegram/publisher';
import {HumanEditor} from './human-editor';
import {PublicationSend} from './publication-send';
import {Badge,JsonView} from './ui';
export async function HumanEditorialPanel({kind,id,initialTitle='',initialBody=''}:{kind:'post'|'news';id:string;initialTitle?:string;initialBody?:string}){
 const user=await requireUser();
 const draft=await db.humanEditorialDraft.findFirst({where:kind==='post'?{sourcePostId:id}:{newsItemId:id},include:{publications:{orderBy:{createdAt:'desc'}}}});
 const people=await db.dashboardUser.findMany({where:{id:{in:[draft?.editedBy,draft?.approvedBy].filter((v):v is string=>!!v&&v.startsWith('user:')).map(v=>v.slice(5))}},select:{id:true,displayName:true}});
 const name=(actor:string|null|undefined)=>people.find(p=>`user:${p.id}`===actor)?.displayName??actor??'لم يعتمد';
 const active=draft?.publications.find(p=>p.status!=='CANCELLED');
 const locked=!!active&&(active.status!=='PENDING'||active.attemptCount>0);
 const stalePreview=!!active&&!!draft&&active.contentSnapshot!==renderPublicationText(draft.title,draft.body);
 let enabled=false;try{assertManualSendEnabled(process.env);readPublisherEnv();enabled=true;}catch{}
 return <>
 <HumanEditor key={`${draft?.id??id}:${draft?.revision??0}:${draft?.status??''}`} kind={kind} id={id} revision={draft?.revision??0} title={draft?.title??initialTitle} body={draft?.body??initialBody} draftId={draft?.id} digest={draft?humanDigest(draft):undefined} status={draft?.status} publicationImageId={draft?.publicationImageId??null} locked={locked}/>
 {active?.publicationImageId&&<Image unoptimized width={800} height={450} className="media-preview" src={`/media/${active.publicationImageId}`} alt="صورة النشر المجمدة"/>}
 {active?.status==='PENDING'&&stalePreview&&<p role="alert">المعاينة المعتمدة تحتاج إلى تصحيح. احفظ النص دون تكرار ثم اعتمده مجدداً؛ تبقى النسخة السابقة محفوظة في السجل.</p>}
 {active?.status==='PENDING'&&draft?.status==='APPROVED'&&<PublicationSend id={active.id} digest={active.idempotencyKey} destination={active.destination} content={active.contentSnapshot} telegramFormatSnapshot={active.telegramFormatSnapshot} enabled={!stalePreview&&(active.destination==='WEB'||enabled)}/>}
 {draft&&<details className="panel"><summary>سجل المراجعة</summary><p>المحرر: {name(draft.editedBy)} · الاعتماد: {name(draft.approvedBy)}</p><p>{draft.approvalNote}</p>
 {draft.publications.map(p=><article key={p.id}><Badge value={p.status}/><p className="original">{p.contentSnapshot}</p><p>الوجهة: <bdi>{p.destination}</bdi> · رسالة Telegram: {p.telegramMessageId??'—'}</p><p>{p.error}</p></article>)}
 {user.role!=='EDITOR'&&<details><summary>تفاصيل تقنية</summary><JsonView value={draft.originalSnapshot}/></details>}</details>}
 </>;
}
export async function HumanEditorialQueue({published=false,approved=false,params={}}:{published?:boolean;approved?:boolean;params?:PageParams}){
 const {drafts,paging}=await db.$transaction(async tx=>{const status=published?'PUBLISHED':approved?'APPROVED':'DRAFT';const paging=pageWindow(pageNumber(params.draftsPage),await tx.humanEditorialDraft.count({where:{status}}));const drafts=await tx.humanEditorialDraft.findMany({where:{status},include:{sourcePost:{include:{source:true}},newsItem:{include:{evidence:{include:{sourcePost:{include:{source:true}}}}}}},orderBy:[{updatedAt:'desc'},{id:'desc'}],skip:paging.skip,take:paging.take});return {drafts,paging};},{isolationLevel:'RepeatableRead'});
 return <section className="panel"><h2>{published?'المنشورات المحررة بشرياً':'مسودات التحرير البشري'}</h2>{drafts.map(d=><article key={d.id}><Link href={d.newsItemId?`/news/${d.newsItemId}`:`/posts/${d.sourcePostId}`}>{d.title}</Link><IngestionSource posts={d.sourcePost?[d.sourcePost]:d.newsItem?.evidence.map(e=>e.sourcePost)??[]}/><p>{d.status==='DRAFT'?'محرر بشرياً — يحتاج الاعتماد':d.status==='APPROVED'?'معتمد بشرياً — متابعة الإرسال':'منشور'}</p></article>)}<Pagination {...paging} path={published?'/published':approved?'/approvals':'/review'} params={params} pageKey="draftsPage" label="مسودات التحرير البشري"/></section>;
}
