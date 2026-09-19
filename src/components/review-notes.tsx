import {reviewMessages} from '@/lib/processing/editorial-eligibility';
export function ReviewNotes({reasons}:{reasons:{code:string;detail?:string}[]}){
 const messages=[...new Set(reviewMessages(reasons).map(s=>s.trim()).filter(Boolean))];
 if(!messages.length)return null;
 return <section className="panel"><h2>ملاحظات المراجعة</h2><ul>{messages.map(message=><li key={message}>{message}</li>)}</ul></section>;
}
