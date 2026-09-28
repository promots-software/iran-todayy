export type OverviewCounts={sources:number;published:number;duplicates:number;unrelatedRejected:number};
export function OverviewStats({counts}:{counts:OverviewCounts|null}) {
 const cards=[
  {key:'sources',label:'المصادر',note:'إجمالي المصادر المسجلة'},
  {key:'published',label:'الأخبار المنشورة اليوم',tone:'green',note:'منشورة بنجاح'},
  {key:'duplicates',label:'الأخبار المكررة',tone:'green',note:'أخبار واردة اليوم',grey:true},
  {key:'unrelatedRejected',label:'الأخبار غير المتعلقة بإيران والمرفوضة',tone:'red',note:'أخبار واردة اليوم'},
 ] as const;
 return <section className="overview-stats" aria-label="إحصاءات اليوم بتوقيت بيروت">
  {cards.map(card=><div key={card.key} className={'overview-stat'+('grey' in card?' overview-stat-grey':'')}>
   <div className="overview-stat-heading"><span>{card.label}</span>{'tone' in card&&<span className={'overview-indicator '+card.tone} aria-hidden="true"/>}</div>
   <strong>{counts?new Intl.NumberFormat('ar-LB').format(counts[card.key]):'—'}</strong>
   <span className="overview-stat-note">{card.note}</span>
  </div>)}
 </section>;
}
