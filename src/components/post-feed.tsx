import Link from "next/link";
import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { Badge, DatabaseNotice } from "./ui";
export async function UnresolvedPosts() {
  const result=await readDatabase(()=>db.sourcePost.findMany({where:{status:"NEEDS_REVIEW",evidence:{none:{}}},take:100,orderBy:{ingestedAt:"desc"},include:{source:true}}));
  if(!result.available)return <DatabaseNotice/>;
  return <>{result.data.map(p=><article className="news-row" key={p.id}><Badge value={p.status}/><h3>{p.source.name}</h3><p className="excerpt" dir="auto">{p.originalContent}</p><Link href={`/posts/${p.id}`} className="text-link">المصدر وسبب المراجعة ←</Link></article>)}</>;
}
