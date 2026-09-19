import {RejectStory} from './reject-story';
import Link from "next/link";
import { db } from "@/lib/db";
import { readDatabase } from "@/lib/queries";
import { DatabaseNotice } from "./ui";
import {EditorialState} from './editorial-state';
export async function UnresolvedPosts() {
  const result=await readDatabase(()=>db.sourcePost.findMany({where:{status:{in:["NEEDS_REVIEW","FAILED"]},evidence:{none:{}},OR:[{humanDraft:{is:null}},{humanDraft:{is:{status:"DRAFT"}}}]},take:100,orderBy:{ingestedAt:"desc"},include:{source:true}}));
  if(!result.available)return <DatabaseNotice/>;
  return <>{result.data.map(p=><article className="news-row" key={p.id}><EditorialState value={p.processingResult} status={p.status} error={p.error}/><h3>{p.source.name}</h3><p className="excerpt" dir="auto">{p.originalContent}</p><Link href={`/posts/${p.id}`} className="text-link">تعديل</Link><RejectStory kind="post" id={p.id}/></article>)}</>;
}
