import {readEditorialState} from '@/lib/processing/editorial-eligibility';
import {RejectStory} from './reject-story';
import Link from 'next/link';
import type {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {DatabaseNotice,EmptyState} from './ui';
import {NewsCard} from './news-card';
import {sourceHasMedia} from '@/lib/publication-media';
export async function NewsFeed({where={},mode='readonly'}:{where?:Prisma.NewsItemWhereInput;mode?:'readonly'|'review'|'approval'}){
 const result=await readDatabase(()=>db.newsItem.findMany({where:{AND:[where,...(mode==='review'?[{OR:[{humanDraft:{is:null}},{humanDraft:{is:{status:'DRAFT' as const}}}]}]:[])]},take:100,orderBy:{createdAt:'desc'},include:{humanDraft:true,evidence:{include:{sourcePost:{include:{source:true}}}}}}));
 if(!result.available)return <DatabaseNotice/>;if(!result.data.length)return <EmptyState/>;
 return <div>{result.data.filter(item=>{const media=item.evidence.some(e=>sourceHasMedia(e.sourcePost.metadata));const ready=readEditorialState(item.validationResult,item.status,item.error)==='READY_TO_PUBLISH';return mode==='approval'?!media&&(ready||item.status==='APPROVED'):mode==='review'?media||!ready:true;}).map(item=><NewsCard key={item.id} title={item.title} body={item.arabicContent} status={item.status} time={item.createdAt} source={[...new Set(item.evidence.map(e=>e.sourcePost.source.name))].join(' · ')} actions={mode!=='readonly'?<div className="controls"><Link className="text-link" href={`/news/${item.id}`}>{mode==='review'?'تعديل':'نشر'}</Link>{mode==='review'&&<RejectStory kind="news" id={item.id}/>}</div>:undefined}/>)}</div>;
}
