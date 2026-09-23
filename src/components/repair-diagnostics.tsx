import {repairDiagnosticSummary} from '@/lib/processing/diagnostic-summary';
export function RepairDiagnostics({result}:{result:unknown}){
 const summary=repairDiagnosticSummary(result);
 if(!summary.initial&&!summary.repair)return null;
 return <section className="panel"><h2>أسباب تعذّر المعالجة</h2>{[
  ['الفشل الأول',summary.initial],['فشل التصحيح',summary.repair],
 ].map(([label,value])=>typeof value==='object'&&value?<div key={String(label)}><strong>{String(label)}: </strong><code dir="ltr">{value.code}</code>{value.paths.length>0&&<p dir="ltr">{value.paths.join('، ')}</p>}</div>:null)}</section>;
}
