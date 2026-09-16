import Link from "next/link";
import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { Badge, DatabaseNotice, EmptyState, PageTitle } from "@/components/ui";
export default async function EventsPage({searchParams}:{searchParams:Promise<{kind?:string}>}) {
  const {kind}=await searchParams;
  const classification=kind === "MATERIAL_UPDATE"?"MATERIAL_UPDATE":kind === "UNCERTAIN_MATCH"?"UNCERTAIN_MATCH":"DUPLICATE";
  const result=await readDatabase(()=>db.eventMatch.findMany({where:{classification},take:100,orderBy:{createdAt:"desc"},include:{sourcePost:{include:{source:true}},eventRevision:{include:{event:true,newsItem:{include:{publication:true}}}}}}));
  return <><PageTitle title="مطابقة الأحداث" description="الأحداث المكررة والتطورات الجوهرية والمطابقات المحتملة مع أدلتها."/><nav className="controls"><Link href="/events?kind=DUPLICATE">المكرر</Link><Link href="/events?kind=MATERIAL_UPDATE">التطورات الجوهرية</Link><Link href="/events?kind=UNCERTAIN_MATCH">مطابقة محتملة</Link></nav><section className="panel">{!result.available?<DatabaseNotice/>:!result.data.length?<EmptyState/>:result.data.map(m=><article key={m.id} className="news-row"><Badge value={m.classification}/><h3>{m.eventRevision.event.title}</h3><p>{m.sourcePost.source.name} · {m.rationale}</p><p>حدث <bdi>{m.eventRevision.eventId}</bdi> · الإصدار {m.eventRevision.revision}{m.eventRevision.newsItem?.publication?.status === "SENT"?" · سبق النشر":""}</p><Link href={`/posts/${m.sourcePostId}`} className="text-link">المصدر وأدلة المطابقة ←</Link></article>)}</section></>;
}
