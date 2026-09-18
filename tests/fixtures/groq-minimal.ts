import type { Understanding } from '../../src/lib/processing/contracts';
export function minimalParts(u:Understanding){
 const e=u.event;
 const span=(v:{evidence:{excerpt:string}}|null)=>v?{excerpt:v.evidence.excerpt,context:v.evidence.excerpt}:null;
 const anchorIds=[...e.actors.map((_,i)=>`actor:${i+1}`),...(['action','object','location'] as const).filter(k=>e[k]),...e.facts.flatMap((f,i)=>f.speaker?[`f${i+1}:speaker`]:[])];
 const {filterReason,priority,sensitiveActor,leaderDeath,seriousClaim,rankUnverified}=u;
 return [
  {relevance:u.relevance,actors:e.actors.map(a=>span(a)!),action:span(e.action),object:span(e.object),location:span(e.location),event_time:span(e.eventTime),statements:e.facts.map(f=>({evidence:span(f)!,speaker:span(f.speaker)}))},
  {anchorIds,factLabels:e.facts.map((f,i)=>({id:`f${i+1}`,kind:f.speaker?f.kind==='CLAIM'?'CLAIM':'STATEMENT':f.kind==='CLAIM'||f.kind==='STATEMENT'?'FACT':f.kind,material:f.material})),filterReason,topic:'UNKNOWN',topicEvidenceId:null,priority,sensitiveActor,leaderDeath,seriousClaim,rankUnverified,rationaleIds:e.facts.map((_,i)=>`f${i+1}`)}
 ] satisfies [unknown,unknown];
}
