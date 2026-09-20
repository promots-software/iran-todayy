import {SourceLink} from './ui';
import {reviewMessages,readEditorialState} from '@/lib/processing/editorial-eligibility';
import {publicationParts} from '@/lib/publication-text';
import {RejectStory} from './reject-story';
import Link from 'next/link';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {DatabaseNotice,EmptyState} from './ui';
import {NewsCard} from './news-card';
import {newsPage,pageNumber,type PageParams} from '@/lib/dashboard-pagination';
import {Pagination} from './pagination';
export async function NewsFeed({mode='readonly',params={},path='/'}:{mode?:'readonly'|'review'|'approval';params?:PageParams;path?:string}){
 const result=await readDatabase(()=>newsPage(db,mode,pageNumber(params.newsPage)));
 if(!result.available)return <DatabaseNotice/>;if(!result.data.items.length)return <EmptyState/>;
 return <div>{result.data.items.map(item=><NewsCard key={item.id} title={item.title} body={publicationParts(item.title,item.arabicContent??'').body} reason={mode==='review'?reviewMessages((item.validationResult as {review?:{code:string;detail?:string}[]})?.review??[]).join(' · '):undefined} status={readEditorialState(item.validationResult,item.status,item.error)==='READY_TO_PUBLISH'?'READY_TO_PUBLISH':item.status} time={item.createdAt} source={[...new Set(item.evidence.map(e=>e.sourcePost.source.name))].join(' · ')} actions={mode!=='readonly'?<div className="controls">{item.evidence.map(e=><SourceLink key={e.sourcePostId} url={e.sourcePost.sourceUrl}/>)}<Link className="text-link" href={`/news/${item.id}`}>{mode==='review'?'تعديل':'معاينة واعتماد'}</Link>{mode==='review'&&<RejectStory kind="news" id={item.id}/>}</div>:undefined}/>)}<Pagination {...result.data} path={path} params={params} pageKey="newsPage" label="الأخبار"/></div>;
}
