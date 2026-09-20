import {RejectStory} from './reject-story';
import Link from 'next/link';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {DatabaseNotice} from './ui';
import {EditorialState} from './editorial-state';
import {unresolvedPage,pageNumber,type PageParams} from '@/lib/dashboard-pagination';
import {Pagination} from './pagination';
export async function UnresolvedPosts({params={}}:{params?:PageParams}) {
 const result=await readDatabase(()=>unresolvedPage(db,pageNumber(params.postsPage)));
 if(!result.available)return <DatabaseNotice/>;
 return <>{result.data.items.map(p=><article className="news-row" key={p.id}><EditorialState value={p.processingResult} status={p.status} error={p.error}/><h3>{p.source.name}</h3><p className="excerpt" dir="auto">{p.originalContent}</p><Link href={`/posts/${p.id}`} className="text-link">تعديل</Link><RejectStory kind="post" id={p.id}/></article>)}<Pagination {...result.data} path="/review" params={params} pageKey="postsPage" label="مواد المراجعة"/></>;
}
