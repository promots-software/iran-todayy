import {safeSourceUrl} from '@/lib/domain';
export type IngestionSourcePost={source:{name:string;handle:string;platform:string};sourceUrl?:string|null};
/** Stored ingestion metadata only; never derive attribution or guess a URL. */
export function IngestionSource({posts}:{posts:IngestionSourcePost[]}){
 return <span className="small" aria-label="مصدر الرصد الأصلي">{posts.map((p,i)=>{const url=p.sourceUrl?safeSourceUrl(p.sourceUrl):null;return <span key={i} style={{display:'block'}}>مصدر الرصد: {p.source.name} — <bdi>{p.source.handle.startsWith('@')?p.source.handle:'@'+p.source.handle}</bdi> — <bdi>{p.source.platform==='TELEGRAM'?'Telegram':p.source.platform==='X'?'X':p.source.platform}</bdi>{url&&<> · <a className="text-link" href={url} target="_blank" rel="noopener noreferrer">المنشور الأصلي ↗</a></>}</span>;})}</span>;
}
