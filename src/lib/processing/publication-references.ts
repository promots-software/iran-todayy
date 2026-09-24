import {checkEvidence,type Understanding} from './contracts';
import {sourceUnits} from './source-units';
/** Objective reference graph, not blanket semantic support. Fact assertions stay
 * limited to selected IDs. Linked coverage units may prove quote typography;
 * exact validated anchors may prove names/places. Independent review still
 * checks whether each assertion actually follows from its selected facts. */
export function publicationReferences(source:string,u:Understanding,factIds:string[]){
 const facts=u.event.facts.filter(f=>factIds.includes(f.id));
 const unitIds=new Set((u.semanticCoverage??[]).filter(r=>!r.nonFactual&&r.factIds.some(id=>factIds.includes(id))).map(r=>r.unitId));
 const units=sourceUnits(source).filter(unit=>unitIds.has(unit.id));
 const references:Array<{arabic:string;evidence:Understanding['event']['facts'][number]['evidence']}>= [...facts,...facts.flatMap(f=>f.speaker?[f.speaker]:[])];
 const anchors=[...u.event.actors,u.event.action,u.event.object,u.event.location,...u.names].filter(v=>v!==null);
 for(const anchor of anchors){
  checkEvidence(source,anchor.evidence);
  if([...facts.map(f=>f.evidence),...units].some(e=>anchor.evidence.start>=e.start&&anchor.evidence.end<=e.end))references.push(anchor);
 }
 for(const ref of references)checkEvidence(source,ref.evidence);
 return {
  evidence:references.map(r=>r.evidence.excerpt).join('\n'),
  arabic:references.map(r=>r.arabic).join('\n'),
  quoteContext:units.map(u=>u.text).join('\n'),
 };
}
