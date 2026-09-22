import type {PrismaClient} from '@prisma/client';
/** Resolve durable foreign keys, not narrative audit text or guessed ID prefixes. */
export async function auditStoryLinks(db:PrismaClient,logs:{id:string;entityType:string|null;entityId:string|null}[]){
 const ids=(type:string)=>logs.filter(l=>l.entityType===type&&l.entityId).map(l=>l.entityId!);
 const [drafts,publications]=await Promise.all([
  db.humanEditorialDraft.findMany({where:{id:{in:ids('HumanEditorialDraft')}},select:{id:true,sourcePostId:true,newsItemId:true}}),
  db.publication.findMany({where:{id:{in:ids('Publication')}},select:{id:true,newsItemId:true,humanDraft:{select:{sourcePostId:true,newsItemId:true}}}}),
 ]);
 const story=(x:{sourcePostId?:string|null;newsItemId?:string|null}|null|undefined)=>x?.sourcePostId?`/posts/${encodeURIComponent(x.sourcePostId)}`:x?.newsItemId?`/news/${encodeURIComponent(x.newsItemId)}`:null;
 return Object.fromEntries(logs.map(l=>[l.id,l.entityType==='SourcePost'&&l.entityId?story({sourcePostId:l.entityId}):l.entityType==='NewsItem'&&l.entityId?story({newsItemId:l.entityId}):l.entityType==='HumanEditorialDraft'?story(drafts.find(d=>d.id===l.entityId)):l.entityType==='Publication'?(()=>{const p=publications.find(p=>p.id===l.entityId);return story(p?.humanDraft??p);})():null]));
}
