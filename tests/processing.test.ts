import test from "node:test";
import assert from "node:assert/strict";
import { matchEvent, type Candidate } from "../src/lib/processing/matcher";
import { editDraft, initialReview, outsideProtected } from "../src/lib/processing/editorial";
import { validateUnderstanding, ProcessingError } from "../src/lib/processing/contracts";
import { ruleSet, pipelineOrder, terminology } from "../src/lib/processing/rules";
import { externalPublicationDecision, UnconfiguredLanguageProvider } from "../src/lib/processing/providers";
import { fixture, fixtureProvider, official, unofficial, scenarios } from "./fixtures/processing";
const when=new Date("2026-08-10T10:00:00Z");
const base=scenarios[0];
const candidate:Candidate={id:"event-1",revisionId:"revision-1",revision:1,publishedAt:when,data:base.understanding.event,published:true};
const signal=new AbortController().signal;
for (const id of ["telegram-b","x-a","english","persian","rewrite"]) test(`semantic duplicate: ${id} (P2.2 p3)`,async()=>{
  const s=scenarios.find(s=>s.id === id)!;
  validateUnderstanding(s.understanding,s.content);
  const result=await matchEvent(s.understanding.event,when,[candidate],fixtureProvider(),signal);
  assert.equal(result.classification,"DUPLICATE");assert.equal(result.candidate?.id,"event-1");
  assert.deepEqual(result.evidence.actors,["person:araghchi"]);
});
test("verified decision creates material update; translation adds no material fact",async()=>{
  const s=scenarios.find(s=>s.id === "update")!;
  const m=await matchEvent(s.understanding.event,when,[candidate],fixtureProvider(),signal);
  assert.equal(m.classification,"MATERIAL_UPDATE");assert.deepEqual(m.newFactIds,["update:agreement"]);
  const unverified=structuredClone(s.understanding.event);unverified.facts[1].verified=false;
  assert.equal((await matchEvent(unverified,when,[candidate],fixtureProvider(),signal)).classification,"UNCERTAIN_MATCH");
});
test("same actors different event stays new; unresolved similarity holds candidate",async()=>{
  assert.equal((await matchEvent(scenarios.find(s=>s.id === "different")!.understanding.event,when,[candidate],fixtureProvider(),signal)).classification,"NEW_EVENT");
  const m=await matchEvent(scenarios.find(s=>s.id === "uncertain")!.understanding.event,when,[candidate],fixtureProvider(),signal);
  assert.equal(m.classification,"UNCERTAIN_MATCH");assert.equal(m.candidates.length,1);
});
test("24h boundary and older historical matches (P2.2 p3)",async()=>{
  assert.equal((await matchEvent(base.understanding.event,new Date(+when+24*3600000),[candidate],fixtureProvider(),signal)).classification,"DUPLICATE");
  assert.equal((await matchEvent(base.understanding.event,new Date(+when+24*3600000+1),[candidate],fixtureProvider(),signal)).classification,"UNCERTAIN_MATCH");
});
test("multiple candidates and contradictory anchors cannot silently merge",async()=>{
  assert.equal((await matchEvent(base.understanding.event,when,[candidate,{...candidate,id:"event-2"}],fixtureProvider(),signal)).classification,"UNCERTAIN_MATCH");
  const changed=structuredClone(base.understanding.event);changed.location!.key="different-place";
  assert.equal((await matchEvent(changed,when,[candidate],fixtureProvider(),signal)).classification,"UNCERTAIN_MATCH");
});
test("quotes, official names, documents and quoted hashtags remain literal (P5 p5; R II)",()=>{
  const content='قناة الشرق الأوسط قالت "الخليج العربي وإسرائيل" في وثيقة الشرق الأوسط #الشرق_الأوسط';
  const out=outsideProtected(content,["قناة الشرق الأوسط","وثيقة الشرق الأوسط","#الشرق_الأوسط"],s=>s.replaceAll("الشرق الأوسط","غرب آسيا").replaceAll("الخليج العربي","الخليج").replaceAll("إسرائيل","دولة الاحتلال"));
  assert.equal(out,content);
  assert.equal(outsideProtected('"a" الشرق الأوسط "b"',[],s=>s.replaceAll("الشرق الأوسط","غرب آسيا")),'"a" غرب آسيا "b"');
});
test("PDF acceptance: official institution retained, geographical phrase transformed (P13.2)",()=>{
  const s=fixture("institution","قناة الشرق الأوسط تنقل عن مصادر في الشرق الأوسط","ar","قناة الشرق الأوسط تنقل عن مصادر في الشرق الأوسط");
  const result=editDraft(s.draft,s.content,s.understanding,official);
  assert.equal(result.title,"قناة الشرق الأوسط تنقل عن مصادر في غرب آسيا");
  assert.ok(result.applied.some(r=>r.ruleId === "T58"));
});
test("PDF serious quoted claim remains untouched and needs review (R II; P4.5/P13.2)",()=>{
  const content='قال وزير الخارجية الأميركي: "إيران تسعى لسلاح نووي في الخليج العربي"';
  const s=fixture("claim",content,"ar",content);s.understanding.seriousClaim=true;
  const result=editDraft(s.draft,content,s.understanding,unofficial);
  assert.ok(result.body.includes('"إيران تسعى لسلاح نووي في الخليج العربي"'));
  assert.ok(result.review.some(r=>r.code === "SERIOUS_CLAIM"));
});
test("PDF review conditions are explicit and preserve uncovered term (P4.1–7)",()=>{
  const u=structuredClone(base.understanding);u.uncoveredTerms=["مصطلح جديد"];u.leaderDeath=true;u.sensitiveActor=true;u.rankUnverified=true;
  u.names.push({...u.names[0],arabic:"اسم جديد"});u.event.facts[0].kind="FIGURE";
  const reasons=initialReview(u,{...unofficial,flagged:true});
  for (const code of ["UNKNOWN_NAME","UNCOVERED_TERM","LEADER_STATUS","SENSITIVE_ACTOR","RANK_UNVERIFIED","SINGLE_UNOFFICIAL_FIGURE","FLAGGED_SOURCE"]) assert.ok(reasons.some(r=>r.code === code),code);
  assert.equal(reasons.find(r=>r.code === "UNCOVERED_TERM")?.detail,"مصطلح جديد");
});
test("PDF transliteration acceptance and source original immutable (R IV; P13.2)",()=>{
  const s=fixture("names","Pezeshkian يزور Chabahar","ar","Pezeshkian يزور Chabahar");
  const result=editDraft(s.draft,s.content,s.understanding,official);
  assert.equal(result.title,"مسعود بزشكيان يزور تشابهار");assert.equal(s.content,"Pezeshkian يزور Chabahar");
});
test("contextual sanctions / casualty wording is not blindly replaced (R I.2–3)",()=>{
  const s=fixture("context","العقوبات الدولية على دولة أخرى وضحايا حادث","ar","العقوبات الدولية على دولة أخرى وضحايا حادث");
  const result=editDraft(s.draft,s.content,s.understanding,official);
  assert.equal(result.title,s.draft.title);assert.ok(result.review.some(r=>r.code === "CONTEXT_REQUIRED"));
});
test("schema and source offsets reject fabricated evidence before persistence",()=>{
  const u=structuredClone(base.understanding);u.event.facts[0].evidence.excerpt="fabricated";
  assert.throws(()=>validateUnderstanding(u,base.content),/INVALID_EVIDENCE/);
  assert.throws(()=>validateUnderstanding({...base.understanding,extra:"ignored?"},base.content),/INVALID_UNDERSTANDING_SCHEMA/);
});
test("unsupported draft sentences, changed quotation, false attestations fail closed",()=>{
  const s=fixture("quote",'قال "الخليج العربي"',"ar",'قال "الخليج العربي"');
  s.draft.title='قال "الخليج الفارسي"';s.draft.body="خبر مختلق";s.draft.sentences=[{text:s.draft.title,factIds:[s.understanding.event.facts[0].id]}];
  const result=editDraft(s.draft,s.content,s.understanding,official);
  assert.ok(result.review.some(r=>r.code === "QUOTE_REVIEW"));assert.ok(result.review.some(r=>r.code === "UNSUPPORTED_OUTPUT"));
});
test("rule catalogue is versioned, complete, traceable; exact documented order",()=>{
  assert.equal(terminology.length,68);assert.equal(new Set(terminology.map(r=>r.id)).size,68);
  assert.ok(terminology.every(r=>r.reference && r.condition && r.to.length));
  assert.equal(ruleSet.provenance[0].precedence,1);
  assert.ok(pipelineOrder.indexOf("PROTECT_QUOTES") < pipelineOrder.indexOf("TERMINOLOGY_AUTOMATIC"));
  assert.ok(pipelineOrder.indexOf("TERMINOLOGY_CONTEXTUAL") < pipelineOrder.indexOf("ATTRIBUTION"));
});
test("no live AI fallback and no external publication regardless of mode",async()=>{
  await assert.rejects(new UnconfiguredLanguageProvider().understand(),(e:unknown)=>e instanceof ProcessingError && e.code === "PROVIDER_UNAVAILABLE");
  assert.equal(externalPublicationDecision().allowed,false);
});
test("unsupported numeric draft and unmatched quote require review (R IX.4; P8)",()=>{
  const s=fixture("number","وردت أنباء عن 5 ضحايا","ar","وردت أنباء عن 50 ضحية");
  assert.ok(editDraft(s.draft,s.content,s.understanding,official).review.some(r=>r.code === "UNSUPPORTED_OUTPUT"));
  s.content='قال "نص غير مكتمل';
  assert.ok(editDraft(s.draft,s.content,s.understanding,official).review.some(r=>r.code === "QUOTE_REVIEW"));
});
