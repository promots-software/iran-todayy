import { JsonView, Badge } from "./ui";
import { date } from "@/lib/labels";
import type { Prisma } from "@prisma/client";
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function ProcessingDetails({ value }: { value: Prisma.JsonValue | null }) {
  const data=record(value), draft=record(data.draft), match=record(data.match);
  const reviews=Array.isArray(data.review)?data.review:[];
  return <section className="panel"><h2>قرار المعالجة والتحرير</h2>
    {typeof data.classification === "string" && <Badge value={data.classification} />}
    <p>{typeof match.rationale === "string" ? match.rationale : "لم تُحسم المطابقة بعد"}</p>
    <p>نسخة القواعد: <bdi>{String(data.ruleSetVersion??"—")}</bdi></p>
    {reviews.map((r,i)=>{const row=record(r);return <p key={i} className="notice"><bdi>{String(row.code??"")}</bdi> · {String(row.explanation??"")} {String(row.detail??"")}</p>;})}
    {typeof draft.title === "string" && <><h3>{draft.title}</h3><p className="original">{String(draft.body??"")}</p></>}
    <details><summary>أدلة المطابقة والاستخراج والقواعد المطبّقة</summary><JsonView value={value}/></details>
  </section>;
}
export function ProcessingHistory({ logs }: { logs: {id:string;createdAt:Date;action:string;message:string}[] }) {
  return <section className="panel"><h2>تاريخ المعالجة</h2>{logs.length?logs.map(l=><article className="news-row" key={l.id}><time>{date(l.createdAt)}</time><p><bdi>{l.action}</bdi> · {l.message}</p></article>):<p className="muted">لا توجد مراحل مسجلة بعد.</p>}</section>;
}
