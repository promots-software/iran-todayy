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
 return <div>{result.data.items.map(item=><NewsCard key={item.id} title={item.title} body={item.arabicContent} status={item.status} time={item.createdAt} source={[...new Set(item.evidence.map(e=>e.sourcePost.source.name))].join(' · ')} actions={mode!=='readonly'?<div className="controls"><Link className="text-link" href={`/news/${item.id}`}>{mode==='review'?'تعديل':'نشر'}</Link>{mode==='review'&&<RejectStory kind="news" id={item.id}/>}</div>:undefined}/>)}<Pagination {...result.data} path={path} params={params} pageKey="newsPage" label="الأخبار"/></div>;
}
