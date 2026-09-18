import Link from 'next/link';
import {db} from '@/lib/db';
import {humanDigest} from '@/lib/human-editorial-contract';
import {assertManualSendEnabled,readPublisherEnv} from '@/lib/telegram/publisher';
import {HumanEditor} from './human-editor';
import {PublicationSend} from './publication-send';
import {Badge,JsonView} from './ui';
export async function HumanEditorialPanel({kind,id,initialTitle='',initialBody=''}:{kind:'post'|'news';id:string;initialTitle?:string;initialBody?:string}){
 const draft=await db.humanEditorialDraft.findFirst({where:kind==='post'?{sourcePostId:id}:{newsItemId:id},include:{publications:{orderBy:{createdAt:'desc'}}}});
 const active=draft?.publications.find(p=>p.status!=='CANCELLED');
 const locked=!!active&&(active.status!=='PENDING'||active.attemptCount>0);
 let enabled=false;try{assertManualSendEnabled(process.env);readPublisherEnv();enabled=true;}catch{}
 return <>
 <HumanEditor key={`${draft?.id??id}:${draft?.revision??0}:${draft?.status??''}`} kind={kind} id={id} revision={draft?.revision??0} title={draft?.title??initialTitle} body={draft?.body??initialBody} draftId={draft?.id} digest={draft?humanDigest(draft):undefined} status={draft?.status} locked={locked}/>
 {active?.status==='PENDING'&&draft?.status==='APPROVED'&&<PublicationSend id={active.id} digest={active.idempotencyKey} destination={active.destination} content={active.contentSnapshot} enabled={enabled}/>}
 {draft&&<section className="panel"><h2>سجل التحرير البشري</h2><p>المحرر: {draft.editedBy} · الاعتماد: {draft.approvedBy??'لم يعتمد'}</p><p>{draft.approvalNote}</p>
 {draft.publications.map(p=><article key={p.id}><Badge value={p.status}/><p className="original">{p.contentSnapshot}</p><p>الوجهة: <bdi>{p.destination}</bdi> · رسالة Telegram: {p.telegramMessageId??'—'}</p><p>{p.error}</p></article>)}
 <details><summary>نسخة المصدر ونتيجة المعالجة الأصلية المحفوظة</summary><JsonView value={draft.originalSnapshot}/></details></section>}
 </>;
}
export async function HumanEditorialQueue({published=false}:{published?:boolean}){
 const drafts=await db.humanEditorialDraft.findMany({where:{status:published?'PUBLISHED':{in:['DRAFT','APPROVED']}},orderBy:{updatedAt:'desc'},take:100});
 return <section className="panel"><h2>{published?'المنشورات المحررة بشرياً':'مسودات التحرير البشري'}</h2>{drafts.map(d=><article key={d.id}><Link href={d.newsItemId?`/news/${d.newsItemId}`:`/posts/${d.sourcePostId}`}>{d.title}</Link><p>{d.status==='DRAFT'?'محرر بشرياً — يحتاج الاعتماد':d.status==='APPROVED'?'معتمد بشرياً — متابعة الإرسال':'منشور'}</p></article>)}</section>;
}
