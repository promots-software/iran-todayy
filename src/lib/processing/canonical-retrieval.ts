import {ProcessingError} from './contracts';
import type {Candidate} from './matcher';

export const CANONICAL_RETRIEVAL_VERSION = 'CANONICAL_RETRIEVAL_V1' as const;
export type RetrievalCandidate = Candidate & {createdAt: Date};
export type RetrievalInput = {
 source: string; draft: string; publishedAt: Date; now: Date; candidates: RetrievalCandidate[];
};

/** Retrieval-only text representation. Never used for evidence coordinates. */
export function retrievalNormalize(text: string, expanded = false): string {
 const base = text.normalize('NFKC').toLowerCase()
  .replace(/https?:\/\/\S+|@[\w]+/g, ' ')
  .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ی/g, 'ي').replace(/ک/g, 'ك')
  .replace(/[۰-۹٠-٩]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.includes(c)
   ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
 return expanded ? base.replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\u200c/g, ' ') : base;
}
export const retrievalTokens = (text: string, expanded = false) =>
 retrievalNormalize(text, expanded).match(/[\p{L}\p{N}]+/gu) ?? [];
const grams = (tokens: string[]) => new Set(tokens.slice(1).map((_, i) => `${tokens[i]} ${tokens[i + 1]}`));
const rank = (scores: number[]) => scores.map((score, i) => ({score, i}))
 .sort((a, b) => b.score - a.score || a.i - b.i).map(x => x.i);
const frequency = (sets: Set<string>[]) => {
 const df = new Map<string, number>();
 for (const set of sets) for (const word of set) df.set(word, (df.get(word) ?? 0) + 1);
 return df;
};
export const retrievalDocument = (c: Candidate) => [c.data.summary,
 ...c.data.facts.flatMap(f => [f.arabic, f.evidence.excerpt])].filter(Boolean).join('\n');
export type RescueSignal = {
 bmRank: number; fpRank: number; timeRank: number; rareTerms: number; rarePhrases: number;
};
export function retrievalRescueReasons(s: RescueSignal): string[] {
 const reasons: string[] = [];
 if (s.bmRank <= 3 && s.fpRank <= 5 && s.rareTerms >= 2) reasons.push('RANK_AGREEMENT');
 if (s.bmRank <= 10 && s.fpRank <= 10 && s.rareTerms >= 2 && s.rarePhrases >= 2) reasons.push('RARE_PHRASE_AND_RANK');
 if (s.timeRank === 1 && s.rareTerms >= 2 && s.rarePhrases >= 1) reasons.push('NEAREST_SOURCE_TIME_AND_RARE_PHRASE');
 return reasons;
}

/** Frozen reconstruction, not Phase2 parity. Full local corpus supplies IDF;
 * only the base path has a five-hour availability window. Rescue has no cap.
 * IEEE-754 Number/Math.log scores are neither rounded nor epsilon-compared.
 * The source plus final pre-match approved title/newline/body is the query.
 */
export function retrieveCanonicalCandidates(input: RetrievalInput) {
 const candidates = [...input.candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
 if (!Number.isFinite(input.now.getTime()) || !Number.isFinite(input.publishedAt.getTime()) ||
  candidates.some(c => !Number.isFinite(c.createdAt.getTime()) || !Number.isFinite(c.publishedAt.getTime())) ||
  new Set(candidates.map(c => c.id)).size !== candidates.length ||
  new Set(candidates.map(c => c.revisionId)).size !== candidates.length) {
  throw new ProcessingError('INVALID_RETRIEVAL_CATALOG');
 }
 const query = `${input.source}\n${input.draft}`;
 const docs = candidates.map(retrievalDocument);
 const tokens = docs.map(d => retrievalTokens(d, true)), sets = tokens.map(t => new Set(t));
 const df = frequency(sets), n = docs.length, threshold = Math.max(1, Math.floor(n * .1));
 const qt = retrievalTokens(query, true), q = new Set(qt), qb = grams(qt), db = tokens.map(grams);
 const avg = tokens.reduce((sum, t) => sum + t.length, 0) / (n || 1);
 const scores = tokens.map(d => {
  const tf = new Map<string, number>();
  for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
  return [...q].reduce((sum, t) => {
   const count = tf.get(t);
   return sum + (count ? Math.log(1 + (n - df.get(t)! + .5) / (df.get(t)! + .5)) * count * 2.2 /
    (count + 1.2 * (.25 + .75 * d.length / avg)) : 0);
  }, 0);
 });
 const fingerprint = sets.map((set, i) => {
  const shared = [...q].filter(t => set.has(t));
  return shared.filter(t => t.length >= 4 && df.get(t)! <= threshold)
   .reduce((sum, t) => sum + Math.log(1 + n / (df.get(t)! + 1)), 0)
   + 2 * [...qb].filter(t => db[i].has(t)).length + .5 * shared.filter(t => /^\d+$/.test(t)).length;
 });
 const bmOrder = rank(scores), fpOrder = rank(fingerprint);
 const timeOrder = rank(candidates.map(c => 1 / (1 + Math.abs(c.publishedAt.getTime() - input.publishedAt.getTime()) / 3600000)));
 // Rescue agreement uses BASE normalization, intentionally distinct from ranking.
 const baseTokens = docs.map(d => retrievalTokens(d)), baseSets = baseTokens.map(t => new Set(t));
 const baseDf = frequency(baseSets), baseGrams = baseTokens.map(grams), bgDf = frequency(baseGrams);
 const baseQuery = retrievalTokens(query), bq = new Set(baseQuery), bqg = grams(baseQuery);
 const signals = candidates.map((c, i) => {
  const signal = {
   bmRank: bmOrder.indexOf(i) + 1, fpRank: fpOrder.indexOf(i) + 1, timeRank: timeOrder.indexOf(i) + 1,
   rareTerms: [...bq].filter(t => baseSets[i].has(t) && t.length >= 4 && baseDf.get(t)! <= threshold).length,
   rarePhrases: [...bqg].filter(t => baseGrams[i].has(t) && bgDf.get(t)! <= threshold && t.split(' ').every(w => w.length >= 3)).length
  };
  return {...signal, reasons: retrievalRescueReasons(signal)};
 });
 const base = bmOrder.filter(i => {
  const age = (input.now.getTime() - candidates[i].createdAt.getTime()) / 3600000;
  return age >= 0 && age <= 5;
 }).slice(0, 3);
 const selected = [...new Set([...base, ...signals.flatMap((s, i) => s.reasons.length ? [i] : [])])];
 return {version: CANONICAL_RETRIEVAL_VERSION, candidates: selected.map(i => candidates[i]),
  base, selected, scores, fingerprint, bmOrder, fpOrder, timeOrder, signals};
}
