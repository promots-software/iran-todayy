import type { Understanding } from '../../src/lib/processing/contracts';
export function minimalParts(u:Understanding){
 const e=u.event;
 const span=(v:{evidence:{excerpt:string}}|null)=>v?{excerpt:v.evidence.excerpt,context:v.evidence.excerpt}:null;
 const label=(v:{key:string;arabic:string}|null)=>v?{key:v.key,arabic:v.arabic,nameKind:null}:null;
 const {filterReason,topic,priority,rationale,sensitiveActor,leaderDeath,seriousClaim,rankUnverified,uncoveredTerms}=u;
 return [
  {relevance:u.relevance,actors:e.actors.map(a=>span(a)!),action:span(e.action),object:span(e.object),location:span(e.location),event_time:span(e.eventTime),statements:e.facts.map(f=>({evidence:span(f)!,speaker:span(f.speaker)}))},
  {filterReason,topic,topicEvidence:null,priority,rationale,sensitiveActor,leaderDeath,seriousClaim,rankUnverified,uncoveredTerms,actors:e.actors.map(a=>label(a)!),action:label(e.action),object:label(e.object),location:label(e.location),statements:e.facts.map((f,i)=>({id:`f${i+1}`,key:f.key,arabic:f.arabic,kind:f.kind,material:f.material,speaker:label(f.speaker)}))}
 ] satisfies [unknown,unknown];
}
