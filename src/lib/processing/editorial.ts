import {attributionLead,normalizeAttributionAgreement} from './attribution-rendering';
import {finalizeBodyPunctuation} from '../publication-finalization';
import {guidelineFindings} from './guideline-checks';
import { checkEvidence, draftSchema, type Draft, type SourceProfile, type Understanding, ProcessingError } from "./contracts";
import { names, reviewReasons, terminology, type ReviewCode } from "./rules";
import {hasEditorialGrounding,unresolvedTerms} from './editorial-grounding';
import {monthLabelConvention,persianMonths,newsroomPrefix} from './newsroom-format';
export type ReviewReason = { code: ReviewCode; explanation: string; reference: string; detail?: string };
export function reason(code: ReviewCode, detail?: string): ReviewReason { return { code, explanation: reviewReasons[code][0], reference: reviewReasons[code][1], ...(detail ? { detail } : {}) }; }
export function literalQuotes(text: string) { return [...text.matchAll(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»/gu)].map(m => ({ text: m[0], start: m.index, end: m.index + m[0].length })); }
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const boundary = (v: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(v)}(?![\\p{L}\\p{N}])`, "gu");
/** Split, transform only unprotected runs, then concatenate without placeholder collisions. */
export function outsideProtected(text: string, protectedTexts: string[], transform: (s: string) => string) {
  const spans = [...literalQuotes(text), ...protectedTexts.flatMap(value => [...text.matchAll(new RegExp(escape(value), "gu"))].map(m=>({start:m.index,end:m.index+value.length})))].sort((a,b)=>a.start-b.start || b.end-a.end);
  let end = 0, result = "";
  for (const span of spans) { if (span.start < end) continue; result += transform(text.slice(end,span.start)) + text.slice(span.start,span.end); end=span.end; }
  return result + transform(text.slice(end));
}
function unprotectedText(text:string, protectedTexts:string[]) {
  const pieces:string[]=[];
  outsideProtected(text,protectedTexts,s=>{pieces.push(s);return s;});
  return pieces.join(" ");
}
export function initialReview(u: Understanding, profile: SourceProfile,content?:string): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  const grounded=hasEditorialGrounding(u,content);
  if (!profile.verified || profile.classification === "UNKNOWN") reasons.push(reason("UNVERIFIED_SOURCE"));
  if (profile.flagged) reasons.push(reason("FLAGGED_SOURCE"));
  if (!grounded&&u.event.facts.some(f=>f.kind === "FIGURE") && profile.authority !== "OFFICIAL") reasons.push(reason("SINGLE_UNOFFICIAL_FIGURE"));
  if (u.leaderDeath&&(!grounded||u.event.facts.some(f=>!f.speaker))) reasons.push(reason("LEADER_STATUS"));
  if (u.sensitiveActor&&!grounded) reasons.push(reason("SENSITIVE_ACTOR"));
  if ((u.seriousClaim || u.event.facts.some(f=>f.kind === "CLAIM"))&&(!grounded||u.event.facts.some(f=>!f.speaker))) reasons.push(reason("SERIOUS_CLAIM"));
  if (u.rankUnverified&&!grounded) reasons.push(reason("RANK_UNVERIFIED"));
  for (const term of unresolvedTerms(u,content)) reasons.push(reason("UNCOVERED_TERM", term));
  for (const n of u.names) {
    const list = n.kind === "person" ? names.people : n.kind === "place" ? names.places : names.institutions;
    if (!list.includes(n.arabic)&&!grounded) reasons.push(reason("UNKNOWN_NAME", n.arabic));
  }
  if (u.relevance === "UNCERTAIN") reasons.push(reason("CONTEXT_REQUIRED", u.rationale));
  if (u.priority === "P4") reasons.push(reason("ARCHIVE_ONLY"));
  return reasons;
}
// Only context-free alternatives are applied automatically by this deterministic layer.
// All other catalogue rows require a validated provider decision and remain reviewable.
const literalAutomatic = new Set(["T01", "T07", "T18", "T45", "T55", "T58", "T63", "T65"]);
const spelling: Record<string,string> = { "إقتصاد":"اقتصاد", "إجتماع":"اجتماع", "إستشهاد":"استشهاد", "إستنفار":"استنفار", "إنتخابات":"انتخابات", "إستقلال":"استقلال", "إتفاق":"اتفاق", "ايران":"إيران", "اسناد":"إسناد", "اعلان":"إعلان", "اضراب":"إضراب", "امين عام":"أمين عام", "قال أن":"قال إن", "أشار أن":"أشار إلى", "شدد أن":"شدد على", "أمريكي":"أميركي", "أمريكية":"أميركية", "مياة":"مياه", "حياه":"حياة", "بليون":"مليار", "بالمائة":"في المئة" };
export function editDraft(raw: unknown, content: string, u: Understanding, profile: SourceProfile) {
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) throw new ProcessingError("INVALID_DRAFT_SCHEMA");
  const draft: Draft = parsed.data;
  const review = initialReview(u, profile,content);
  const sourceQuotes = literalQuotes(content);
  const outputText = draft.title + "\n" + draft.body;
  if (!draft.sentences.some(s=>s.text===draft.title)) throw new ProcessingError("MISSING_TITLE_PROVENANCE");
  if ((content.match(/"/g)?.length ?? 0) % 2 || (content.match(/«/g)?.length ?? 0) !== (content.match(/»/g)?.length ?? 0) || (content.match(/“/g)?.length ?? 0) !== (content.match(/”/g)?.length ?? 0)) review.push(reason("QUOTE_REVIEW"));
  for (const span of draft.protectedSpans) {
    checkEvidence(content, span.evidence);
    if (!span.evidence.excerpt.includes(span.text)) throw new ProcessingError("INVALID_PROTECTED_SPAN");
    if (!outputText.includes(span.text)) throw new ProcessingError("INVALID_PROTECTED_SPAN");
    if (span.kind === "QUOTE" && !sourceQuotes.some(q=>q.text===span.text && q.start>=span.evidence.start && q.end<=span.evidence.end)) throw new ProcessingError("INVALID_LITERAL_QUOTE");
  }
  const protectedTexts = [...sourceQuotes.map(q=>q.text), ...draft.protectedSpans.map(s=>s.text), ...names.institutions, "قناة الشرق الأوسط"];
  const joined = draft.title + "\n" + draft.body;
  const digits=(s:string)=>s.replace(/[٠-٩۰-۹]/gu,c=>String("٠١٢٣٤٥٦٧٨٩".includes(c)?"٠١٢٣٤٥٦٧٨٩".indexOf(c):"۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
  const sourceNumbers=new Set(digits(content).match(/\d+(?:[.,]\d+)*/g)??[]);
  if ((digits(joined).match(/\d+(?:[.,]\d+)*/g)??[]).some(n=>!sourceNumbers.has(n))) review.push(reason("UNSUPPORTED_OUTPUT","رقم في المسودة غير موجود في المصدر؛ التحويل يحتاج دليلاً"));
  // Quotes may be faithfully paraphrased; only output presented as literal is protected.
  for (const q of literalQuotes(joined)) if (!content.includes(q.text)) review.push(reason("UNSUPPORTED_OUTPUT", "QUOTE_INTEGRITY_FAILURE"));
  const factIds = new Set(u.event.facts.map(f=>f.id));
  const used = new Set<string>();
  for (const s of draft.sentences) {
    if (!joined.includes(s.text) || s.factIds.some(id=>!factIds.has(id))) throw new ProcessingError("INVALID_DRAFT_FACT_LINK");
    s.factIds.forEach(id=>used.add(id));
  }
  let unaccounted = joined;
  for (const s of [...draft.sentences].sort((a,b)=>b.text.length-a.text.length)) unaccounted = unaccounted.split(s.text).join("");
  if (unaccounted.trim()) throw new ProcessingError("INCOMPLETE_DRAFT_PROVENANCE");
  if (u.event.facts.some(f=>!used.has(f.id))) review.push(reason("UNSUPPORTED_OUTPUT","UNCOVERED_FACT"));
  // Missing editorial judgment is a review requirement, never proof of a false fact.
  // Factual, attribution and numeric failures retain UNSUPPORTED_OUTPUT handling.
  const editorialJudgments = new Set(['titlesChecked','spellingChecked','noUncoveredTerms']);
  for(const [key,passed] of Object.entries(draft.attestation)) if(!passed) review.push(reason(editorialJudgments.has(key)?"EDITORIAL_ATTESTATION_REQUIRED":"UNSUPPORTED_OUTPUT",`ATTESTATION_NOT_ESTABLISHED: ${key}`));
  const applied: { ruleId: string; from: string; to: string; reference: string; context?: string }[] = [];
  let title = draft.title, body = draft.body;
  const sentenceEvidence=draft.sentences.map(s=>({...s,factIds:[...s.factIds]}));
  const transform = (fn: (s:string)=>string) => { title=outsideProtected(title,protectedTexts,fn); body=outsideProtected(body,protectedTexts,fn); sentenceEvidence.forEach(s=>{s.text=outsideProtected(s.text,protectedTexts,fn);}); };
  for(const fact of u.event.facts)if(fact.speaker)transform(s=>normalizeAttributionAgreement(s,fact.speaker!.arabic));
  // Owner convention is typography, not a geographical/political substitution.
  transform(s=>s.replace(boundary('إسرائيل'),'"إسرائيل"'));
  for (const rule of terminology.filter(r=>r.mode === "automatic")) {
    if (!literalAutomatic.has(rule.id)) continue;
    for (const from of rule.from) transform(s=>s.replace(boundary(from),()=>{ applied.push({ruleId:rule.id,from,to:rule.to[0],reference:rule.reference});return rule.to[0]; }));
  }
  for (const mode of ["automatic", "contextual"] as const) for (const decision of draft.decisions) {
    const rule=terminology.find(r=>r.id===decision.ruleId);
    if (!rule || !rule.from.includes(decision.from) || !rule.to.includes(decision.to)) throw new ProcessingError("INVALID_RULE_DECISION");
    checkEvidence(content,decision.evidence);
    if (rule.mode !== mode) continue;
    // Context-bearing decisions remain subject to operator review in this fixture-only release.
    if (!literalAutomatic.has(rule.id)) review.push(reason("CONTEXT_REQUIRED", `${rule.id}: ${decision.context}`));
    transform(s=>s.replace(boundary(decision.from),()=>{applied.push({ruleId:rule.id,from:decision.from,to:decision.to,reference:rule.reference,context:decision.context});return decision.to;}));
  }
  const visible = unprotectedText(title+"\n"+body, protectedTexts);
  for (const rule of terminology) {
    if (rule.from.some(f=>boundary(f).test(visible)) && !applied.some(a=>a.ruleId === rule.id)) review.push(reason("CONTEXT_REQUIRED", rule.id));
  }
  // Attribution is validated rather than adding an unverified speaker or upgrading a claim.
  if (["WESTERN","HEBREW"].includes(profile.classification) || u.seriousClaim) {
    const scopedStatement=draft.format==='STATEMENT'&&hasEditorialGrounding(u,content)&&u.event.facts.every(f=>f.speaker&&title===newsroomPrefix+attributionLead(f.speaker.arabic))&&draft.sentences.filter(s=>s.text!==draft.title).every(s=>s.factIds.length===1&&s.text===`- ${u.event.facts.find(f=>f.id===s.factIds[0])?.arabic}`);
    if (!/(?:حسب|ذكرت|نقلت|قال|زعم|ادّعى|ادعى)/u.test(title) || (body.trim()&&!scopedStatement&&!/(?:حسب|ذكرت|نقلت|قال|زعم|ادّعى|ادعى)/u.test(body))) review.push(reason("UNSUPPORTED_OUTPUT", "النسب الصريح مطلوب في العنوان والمتن"));
  }
  if ((joined.match(/زعم|ادّعى|ادعى/gu)?.length ?? 0)>1) review.push(reason("FORMAT_REVIEW", "الإفراط في أفعال التشكيك"));
  for (const [from,to] of Object.entries(names.aliases)) transform(s=>s.replace(boundary(from),to));
  for (const [from,to] of Object.entries(spelling)) transform(s=>s.replace(boundary(from),to));
  transform(s=>s.replace(/[٠-٩۰-۹]/gu,c=>String("٠١٢٣٤٥٦٧٨٩".includes(c)?"٠١٢٣٤٥٦٧٨٩".indexOf(c):"۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/(?<!\d),|,(?!\d)/g,"،").replace(/;/g,"؛").replace(/\?/g,"؟").replace(/\s+([،؛؟!:.])/gu,"$1").replace(/([!؟])\1+/gu,"$1"));
  const beforeTitle=title;
  title=outsideProtected(title,protectedTexts,s=>s.replace(/غزّة/gu,"غزة")).replace(/\.$/u,"");
  if(title!==beforeTitle) {
    const entry=sentenceEvidence.find(s=>s.text===beforeTitle);
    if(!entry)throw new ProcessingError("MISSING_TITLE_PROVENANCE");
    // Keep body provenance if the same sentence also occurs in the body.
    sentenceEvidence.push({...entry,text:title,factIds:[...entry.factIds]});
    if(!body.includes(beforeTitle))sentenceEvidence.splice(sentenceEvidence.indexOf(entry),1);
  }
  transform(monthLabelConvention);
  if(Object.keys(persianMonths).some(m=>unprotectedText(title+'\n'+body,protectedTexts).includes(m)))review.push(reason('FORMAT_REVIEW','تاريخ إيراني محدد يحتاج تحويلاً تقويمياً موثقاً؛ تبديل اسم الشهر لا يكفي'));
  const hashtags:string[]=[];
  if(!title.startsWith(newsroomPrefix)){
    const entry=sentenceEvidence.find(s=>s.text===title);
    if(!entry)throw new ProcessingError('MISSING_TITLE_PROVENANCE');
    title=newsroomPrefix+title;
    sentenceEvidence.push({...entry,text:title,factIds:[...entry.factIds]});
    if(!body.includes(entry.text))sentenceEvidence.splice(sentenceEvidence.indexOf(entry),1);
  }
  const finalBody=finalizeBodyPunctuation(body);
  if(finalBody!==body&&finalBody){
    const old=body.trimEnd();
    const entry=[...sentenceEvidence].sort((a,b)=>b.text.length-a.text.length).find(s=>old.endsWith(s.text));
    if(!entry)throw new ProcessingError('INCOMPLETE_DRAFT_PROVENANCE');
    const finalSentence=finalizeBodyPunctuation(entry.text);
    sentenceEvidence.push({...entry,text:finalSentence,factIds:[...entry.factIds]});
    body=finalBody;
    if(!(title+'\n'+body).includes(entry.text))sentenceEvidence.splice(sentenceEvidence.indexOf(entry),1);
  }
  if(!finalBody)body='';
  for(const detail of guidelineFindings(title,body,draft.protectedSpans.filter(s=>s.kind==='QUOTE').map(s=>s.text)))review.push(reason('FORMAT_REVIEW',detail));
  const unique = [...new Map(review.map(r=>[r.code+":"+(r.detail??""),r])).values()];
  if(!sentenceEvidence.some(s=>s.text===title)||sentenceEvidence.some(s=>!(title+'\n'+body).includes(s.text)))throw new ProcessingError("INVALID_FINAL_PROVENANCE");
  return { title, body,format:draft.format, hashtags, protectedQuotes: sourceQuotes, protectedSpans: draft.protectedSpans, applied, review: unique, sentenceEvidence };
}
