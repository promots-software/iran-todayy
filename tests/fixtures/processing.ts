import type { Draft, EventData, SourceProfile, Understanding } from "../../src/lib/processing/contracts";
import { FixtureLanguageProvider } from "../../src/lib/processing/providers";
export const official:SourceProfile={verified:true,flagged:false,classification:"IRAN_OFFICIAL",authority:"OFFICIAL",approvedAnalyst:false,evidence:"Synthetic fixture official source, not a claim about a live account"};
export const unofficial:SourceProfile={...official,classification:"NEUTRAL",authority:"NEWSPAPER"};
export function fixture(id:string,content:string,language="ar",arabic="عباس عراقجي يزور طهران"): {id:string;content:string;understanding:Understanding;draft:Draft;reference:string} {
  const evidence={excerpt:content,start:0,end:content.length};
  const atom=(key:string,ar:string)=>({key,arabic:ar,evidence});
  const event:EventData={actors:[atom("person:araghchi","عباس عراقجي")],action:atom("visit","زيارة"),object:atom("city:tehran","طهران"),location:atom("city:tehran","طهران"),eventTime:null,facts:[{id:`${id}:visit`,key:"araghchi-visits-tehran-2026-08-10",arabic,evidence,kind:"FACT",material:false,speaker:null,verified:true}],summary:id};
  const understanding:Understanding={language,relevance:"POLITICAL_NEWS",filterReason:"NONE",topic:"IRAN_DOMESTIC",priority:"P2",rationale:"زيارة سياسية في بيانات الاختبار",event,names:[{arabic:"عباس عراقجي",kind:"person",evidence},{arabic:"طهران",kind:"place",evidence}],sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,uncoveredTerms:[]};
  const draft:Draft={title:arabic,body:arabic,format:"NEWS",sentences:[{text:arabic,factIds:[event.facts[0].id]}],protectedSpans:[],decisions:[],hashtags:["#إيران_الآن"],attestation:{factsPreserved:true,attributionChecked:true,titlesChecked:true,spellingChecked:true,numbersChecked:true,noUncoveredTerms:true}};
  return {id,content,understanding,draft,reference:"P2.2 p3 semantic duplicate window; user Phase2 fixtures 1–8"};
}
export const scenarios=[
  fixture("telegram-a","عباس عراقجي يزور طهران"),
  fixture("telegram-b","وصل عباس عراقجي إلى طهران في زيارة"),
  fixture("x-a","زيارة إلى طهران يقوم بها عباس عراقجي"),
  fixture("english","Abbas Araghchi visits Tehran.","en"),
  fixture("persian","عباس عراقچی به تهران سفر کرد.","fa"),
  fixture("rewrite","طهران تستقبل عباس عراقجي في زيارته"),
  fixture("update","عباس عراقجي يزور طهران ويعلن توقيع اتفاق للتعاون خلال الاجتماع الرسمي","ar","عباس عراقجي يزور طهران ويعلن توقيع اتفاق للتعاون خلال الاجتماع الرسمي"),
  fixture("different","عباس عراقجي يزور شيراز","ar","عباس عراقجي يزور شيراز"),
  fixture("uncertain","تقارير عن زيارة عباس عراقجي إلى مدينة إيرانية","ar","تقارير عن زيارة عباس عراقجي إلى مدينة إيرانية"),
];
const update=scenarios.find(s=>s.id === "update")!;
update.understanding.event.facts[0].arabic="عباس عراقجي يزور طهران";
update.understanding.event.facts.push({...update.understanding.event.facts[0],id:"update:agreement",key:"araghchi-signs-agreement-2026-08-10",arabic:"يعلن توقيع اتفاق للتعاون خلال الاجتماع الرسمي",kind:"DECISION",material:true});
update.understanding.event.summary="تحديث الاتفاق";
update.draft.sentences[0].factIds.push("update:agreement");
// Material-update matching now proves grounding from exact source spans, not
// the legacy verified boolean. Give this fixture real per-field evidence.
const updateEvidence=(excerpt:string)=>({excerpt,start:update.content.indexOf(excerpt),end:update.content.indexOf(excerpt)+excerpt.length});
for(const entry of [...update.understanding.event.actors,...update.understanding.names])entry.evidence=updateEvidence(entry.arabic);
update.understanding.event.action!.arabic='يزور';
for(const entry of [update.understanding.event.action,update.understanding.event.object,update.understanding.event.location,...update.understanding.event.facts])if(entry)entry.evidence=updateEvidence(entry.arabic);
const different=scenarios.find(s=>s.id === "different")!;
different.understanding.event.object!.key="city:shiraz";
different.understanding.event.location!.key="city:shiraz";
different.understanding.event.object!.arabic="شيراز";
different.understanding.event.location!.arabic="شيراز";
different.understanding.event.facts[0].key="araghchi-visits-shiraz-2026-08-10";
different.understanding.names[1].arabic="شيراز";
const uncertain=scenarios.find(s=>s.id === "uncertain")!;
uncertain.understanding.event.object=null;uncertain.understanding.event.location=null;
uncertain.understanding.event.facts[0].key="unconfirmed-visit";
uncertain.understanding.names=uncertain.understanding.names.slice(0,1);
/** Hand-labelled semantic fixture groups; this is a test oracle, not a production matcher. */
export function fixtureProvider(records=scenarios) {
  const sameGroup=new Set(["telegram-a","telegram-b","x-a","english","persian","rewrite","تحديث الاتفاق"]);
  return new FixtureLanguageProvider(records,(a,b)=>{
    const relation=a.summary === "uncertain" || b.summary === "uncertain" ? "UNCERTAIN" : sameGroup.has(a.summary??"")&&sameGroup.has(b.summary??"") ? "SAME" : a.summary === b.summary ? "SAME" : "DIFFERENT";
    return {relation,rationale:relation === "SAME"?"المصدران يصفان زيارة عراقجي نفسها إلى طهران":relation === "DIFFERENT"?"الزيارتان حدثان مختلفان":"هوية الزيارة ومكانها غير محسومين",newFactIds:a.summary === "تحديث الاتفاق"&&!b.facts.some(f=>f.key === "araghchi-signs-agreement-2026-08-10")?["update:agreement"]:[],conflictingFactIds:[]};
  });
}
