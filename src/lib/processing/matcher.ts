import {directSourceGrounded} from './direct-generation';
import { comparisonSchema, type EventData, type LanguageProvider, type Understanding, ProcessingError } from "./contracts";
import {hasEditorialGrounding} from './editorial-grounding';
import { ruleSet } from "./rules";
export type Candidate = { id: string; revisionId: string; revision: number; publishedAt: Date; data: EventData; published: boolean };
export type MatchDecision = { classification: "NEW_EVENT" | "DUPLICATE" | "MATERIAL_UPDATE" | "UNCERTAIN_MATCH"; candidate?: Candidate; rationale: string; newFactIds: string[]; evidence: Record<string, unknown>; candidates: { id: string; revisionId: string; rationale: string; evidence: Record<string, unknown> }[] };
const norm = (s: string) => s.normalize("NFKC").toLowerCase().trim();
const equal = (a: { key: string } | null, b: { key: string } | null) => !!a && !!b && norm(a.key) === norm(b.key);
/** Only identical validated semantic data, ignoring provenance locations/IDs.
 * Different wording, identities, roles, dates, verification or numbers still
 * requires the existing semantic provider and temporal/conflict checks. */
export function sameValidatedEvent(a:EventData,b:EventData){
 const semantic=(value:unknown):unknown=>Array.isArray(value)?value.map(semantic):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!['evidence','id'].includes(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,semantic(v)])):value;
 return JSON.stringify(semantic(a))===JSON.stringify(semantic(b));
}
export type MatchGrounding={source:string;understanding:Understanding;processingMode?:'NORMAL'|'DIRECT'};
export async function matchEvent(incoming: EventData, publishedAt: Date, candidates: Candidate[], provider: LanguageProvider, signal: AbortSignal, grounding?:MatchGrounding): Promise<MatchDecision> {
  const results: (MatchDecision & { candidate: Candidate })[] = [];
  // Only identical semantic input is reused. Each event still gets its own
  // temporal/conflict decision; multiple matches still require human review.
  const comparisons=new Map<string,unknown>();
  for (const c of candidates) {
    const old = c.data;
    const actors = incoming.actors.filter(a => old.actors.some(b => equal(a, b))).map(a => a.key);
    const action = equal(incoming.action, old.action), object = equal(incoming.object, old.object), location = equal(incoming.location, old.location);
    const locationConflict = !!incoming.location && !!old.location && !location;
    const objectConflict = !!incoming.object && !!old.object && !object;
    const timeA = incoming.eventTime ? Date.parse(incoming.eventTime.iso) : publishedAt.getTime();
    const timeB = old.eventTime ? Date.parse(old.eventTime.iso) : c.publishedAt.getTime();
    const elapsedHours = Math.abs(publishedAt.getTime() - c.publishedAt.getTime()) / 3600000;
    const timeConflict = !!incoming.eventTime && !!old.eventTime && Math.abs(timeA-timeB) > ruleSet.duplicateWindowHours*3600000;
    const factsOverlap = incoming.facts.filter(f => old.facts.some(o => norm(o.key) === norm(f.key))).map(f => f.id);
    // Entities alone never establish sameness. Meaning is checked for every plausible candidate.
    if (!actors.length && !factsOverlap.length) continue;
    const comparisonInput={incoming,existing:old},comparisonKey=JSON.stringify(comparisonInput);
    const raw = sameValidatedEvent(incoming,old)?{relation:'SAME',newFactIds:[],conflictingFactIds:[],rationale:'تطابق كامل للحقائق والمرتكزات المثبتة؛ تُفحص المدة والتعارض محلياً'}:comparisons.has(comparisonKey)?comparisons.get(comparisonKey):await provider.compare(comparisonInput, signal);
    comparisons.set(comparisonKey,raw);
    const parsed = comparisonSchema.safeParse(raw);
    if (!parsed.success) throw new ProcessingError("INVALID_COMPARISON_SCHEMA");
    const semantic = parsed.data;
    const knownIds = new Set(incoming.facts.map(f => f.id));
    if ([...semantic.newFactIds, ...semantic.conflictingFactIds].some(id => !knownIds.has(id))) throw new ProcessingError("INVALID_COMPARISON_EVIDENCE");
    const fresh = incoming.facts.filter(f => !old.facts.some(o => norm(o.key) === norm(f.key)));
    // Independent truth verification is NOT evidence grounding. A provider's
    // boolean cannot authorize updates. Revalidate the exact incoming event,
    // source spans, attribution and reviewed translations at this boundary.
    const sourceGrounded=!!grounding&&JSON.stringify(grounding.understanding.event)===JSON.stringify(incoming)&&(grounding.processingMode==='DIRECT'?directSourceGrounded(grounding.understanding,grounding.source):hasEditorialGrounding(grounding.understanding,grounding.source));
    const material = fresh.filter(f => f.material && sourceGrounded && ["FIGURE", "DECISION", "OUTCOME", "STATEMENT"].includes(f.kind) && semantic.newFactIds.includes(f.id));
    const anchors = actors.length > 0 && action && (object || location || (!!incoming.eventTime && !!old.eventTime && timeA === timeB));
    const contradiction = timeConflict || semantic.conflictingFactIds.length > 0;
    const evidence = { actors, action, object, location, anchors, elapsedHours, insideDuplicateWindow: elapsedHours <= ruleSet.duplicateWindowHours, locationConflict, objectConflict, timeConflict, factsOverlap, newFacts: fresh.map(f=>f.id), materialFacts: material.map(f=>f.id), sourceGrounded,materialBasis:'source-grounded-not-independent-truth', semantic, matcherVersion: "layered-v1" };
    if (semantic.relation === "DIFFERENT") continue;
    let classification: MatchDecision["classification"] = "UNCERTAIN_MATCH";
    // Historical relationship remains visible, but the 24h rule is never silently extended.
    if (semantic.relation === "SAME" && !contradiction && elapsedHours <= ruleSet.duplicateWindowHours) {
      classification = material.length ? "MATERIAL_UPDATE" : semantic.newFactIds.length ? "UNCERTAIN_MATCH" : "DUPLICATE";
    }
    results.push({ classification, candidate: c, rationale: semantic.rationale, newFactIds: material.map(f=>f.id), evidence, candidates: [] });
  }
  const explained = results.map(r => ({ id: r.candidate.id, revisionId: r.candidate.revisionId, rationale: r.rationale, evidence: r.evidence }));
  if (!results.length) return { classification: "NEW_EVENT", rationale: "لم يثبت تطابق مع حدث محفوظ", newFactIds: [], evidence: { checkedCandidates: candidates.length }, candidates: [] };
  if (results.length !== 1) return { classification: "UNCERTAIN_MATCH", rationale: "توجد أحداث مرشحة متعددة؛ يلزم حسم المراجعة", newFactIds: [], evidence: { count: results.length }, candidates: explained };
  return { ...results[0], candidates: explained };
}
