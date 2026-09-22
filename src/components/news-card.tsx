import type {ReactNode} from 'react';
import {Badge} from './ui';
import {date} from '@/lib/labels';
export function NewsCard({title,body,source,time,status,actions,reason}:{title:string;body?:string|null;source:ReactNode;time:Date;status:string;actions?:ReactNode;reason?:string}){const tone=['REJECTED','FILTERED','FAILED'].includes(status)?'rejected':status==='DUPLICATE'?'duplicate':status==='NEEDS_REVIEW'?'review':'ready';return <article className="news-row" data-tone={tone}><div className="section-title"><Badge value={status}/><time>{date(time)}</time></div><h3>{title}</h3>{body&&<p className="excerpt" dir="auto">{body}</p>}{reason&&<p>{reason}</p>}<div className="section-title"><span className="muted small">{source}</span>{actions}</div></article>;}
