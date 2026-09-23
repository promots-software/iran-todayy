import { z } from "zod";
import type { ruleSet } from "./rules";
import {directPublicationReceiptSchema} from './direct-publication-contract';
import {renderingReceiptSchema} from './rendering-contract';
import {directGenerationSchema} from './direct-generation-contract';
const text = z.string().min(1).max(20000);
export const sourceProfileSchema = z.object({
  verified: z.boolean(), flagged: z.boolean(),
  classification: z.enum(["IRAN_OFFICIAL", "RESISTANCE", "WESTERN", "HEBREW", "NEUTRAL", "UNKNOWN"]),
  authority: z.enum(["OFFICIAL", "AGENCY", "NEWSPAPER", "ANALYST", "UNKNOWN"]),
  approvedAnalyst: z.boolean(), evidence: text,
}).strict();
export type SourceProfile = z.infer<typeof sourceProfileSchema>;
export const unknownProfile: SourceProfile = { verified: false, flagged: false, classification: "UNKNOWN", authority: "UNKNOWN", approvedAnalyst: false, evidence: "لم يقدم تصنيف موثق للمصدر" };
export const incomingSchema = z.object({
  externalId: z.string().min(1).max(300), url: z.url().refine(v => new URL(v).protocol === "https:"),
  // Telegram can expose media/service messages without text. Ingest validates
  // their transport metadata locally; factual evidence still requires text.
  content: z.string().max(20000), publishedAt: z.coerce.date(), metadata: z.record(z.string(), z.json()).default({}),
}).strict();
export type Incoming = z.infer<typeof incomingSchema>;
export const evidenceSchema = z.object({ excerpt: text, start: z.number().int().nonnegative(), end: z.number().int().positive(), sourcePostId: z.string().optional() }).strict();
const supported = z.object({ key: text, arabic: text, evidence: evidenceSchema }).strict();
export const eventSchema = z.object({
  actors: z.array(supported).max(30), action: supported.nullable(), object: supported.nullable(), location: supported.nullable(),
  eventTime: z.object({ iso: z.iso.datetime(), evidence: evidenceSchema }).strict().nullable(),
  facts: z.array(z.object({ id: text, key: text, arabic: text, evidence: evidenceSchema,
    kind: z.enum(["FACT", "CLAIM", "FIGURE", "DECISION", "OUTCOME", "STATEMENT"]),
    // Legacy independent real-world verification claim, NOT proof of source
    // grounding. Never promote this flag merely because extraction validated.
    // Matcher requires separately revalidated source/translation evidence.
    material: z.boolean(), speaker: supported.nullable(), verified: z.boolean(),
  }).strict()).max(100),
  summary: text.nullable(),
}).strict();
export type EventData = z.infer<typeof eventSchema>;
export const understandingSchema = z.object({
  language: z.string().min(2).max(35), relevance: z.enum(["POLITICAL_NEWS", "IRRELEVANT", "UNCERTAIN"]),
  filterReason: z.enum(["NONE", "UNRELATED", "ADVERTISING", "SPORT", "ENTERTAINMENT", "SATIRE", "RUMOUR", "OPINION", "INCITEMENT"]),
  topic: z.enum(["IRAN_DOMESTIC", "DEFENCE", "NUCLEAR", "REGION", "GULF", "WEST", "ISRAEL", "GREAT_POWERS", "SECURITY", "HISTORY", "UNKNOWN"]),
  priority: z.enum(["P1", "P2", "P3", "P4"]), rationale: text, event: eventSchema,
  names: z.array(z.object({ arabic: text, kind: z.enum(["person", "place", "institution"]), evidence: evidenceSchema }).strict()),
  sensitiveActor: z.boolean(), leaderDeath: z.boolean(), seriousClaim: z.boolean(), rankUnverified: z.boolean(),
  uncoveredTerms: z.array(text),
  rendering: renderingReceiptSchema.optional(),
  publicationProposal: directPublicationReceiptSchema.optional(),
  directGeneration: directGenerationSchema.optional(),
}).strict();
export type Understanding = z.infer<typeof understandingSchema>;
export const comparisonSchema = z.object({
  relation: z.enum(["SAME", "DIFFERENT", "UNCERTAIN"]), rationale: text,
  newFactIds: z.array(text), conflictingFactIds: z.array(text),
}).strict();
export type Comparison = z.infer<typeof comparisonSchema>;
export const draftSchema = z.object({
  title: text, body: z.string().max(20000), format: z.enum(["NEWS", "BREAKING", "FLASH", "STATEMENT", "STANDARD_STORY", "MULTI_POINT_REPORT", "UNCERTAIN_REPORT", "VISUAL", "UPDATE", "QUOTE_LED"]),
  // Every sentence must be covered by a supported fact; validator checks complete coverage.
  sentences: z.array(z.object({ text, factIds: z.array(text).min(1) }).strict()).min(1),
  protectedSpans: z.array(z.object({ text, kind: z.enum(["QUOTE", "OFFICIAL_NAME", "DOCUMENT", "QUOTED_HASHTAG"]), evidence: evidenceSchema }).strict()),
  decisions: z.array(z.object({ ruleId: text, from: text, to: text, evidence: evidenceSchema, context: text }).strict()),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u)).max(5),
  attestation: z.object({ factsPreserved: z.boolean(), attributionChecked: z.boolean(), titlesChecked: z.boolean(), spellingChecked: z.boolean(), numbersChecked: z.boolean(), noUncoveredTerms: z.boolean() }).strict(),
}).strict();
export type Draft = z.infer<typeof draftSchema>;
export interface LanguageProvider {
  readonly id: string;
  readonly live: boolean;
  readonly draftOnlyAccepted?: boolean;
  readonly constrainedRewrite?: boolean;
  understand(input: { processingMode?: "NORMAL"|"DIRECT"; content: string; publishedAt: Date; profile: SourceProfile; rules: typeof ruleSet }, signal: AbortSignal): Promise<unknown>;
  compare(input: { incoming: EventData; existing: EventData }, signal: AbortSignal): Promise<unknown>;
  draft(input: { processingMode?: "NORMAL"|"DIRECT"; content: string; understanding: Understanding; rules: typeof ruleSet }, signal: AbortSignal): Promise<unknown>;
}
export interface Monitor {
  readonly id: string;
  readonly live: boolean;
  poll(input: { handle: string; cursor: unknown }, signal: AbortSignal): Promise<{ posts: Incoming[]; cursor: unknown; retryAfterMs?: number; hasMore?: boolean }>;
}
export class ProcessingError extends Error {
  availableDraft?: import('./available-draft').AvailableDraft;
  constructor(public readonly code: string, public readonly retryable = false, public readonly diagnostic?: {stage:'extract';field:string;output:unknown}|{stage:string;issues:{code:string;path:(string|number)[]}[]}, public readonly retryAfterMs=0) { super(code); }
}
export function checkEvidence(content: string, evidence: z.infer<typeof evidenceSchema>) {
  if (content.slice(evidence.start, evidence.end) !== evidence.excerpt) throw new ProcessingError("INVALID_EVIDENCE");
}
export function validateUnderstanding(raw: unknown, content: string): Understanding {
  const parsed = understandingSchema.safeParse(raw);
  if (!parsed.success) throw new ProcessingError("INVALID_UNDERSTANDING_SCHEMA");
  const u = parsed.data;
  const e = u.event;
  for (const x of [...e.actors, e.action, e.object, e.location, e.eventTime, ...e.facts, ...e.facts.map(f => f.speaker), ...u.names]) if (x) checkEvidence(content, x.evidence);
  if (new Set(e.facts.map(f => f.id)).size !== e.facts.length || new Set(e.facts.map(f => f.key)).size !== e.facts.length) throw new ProcessingError("DUPLICATE_FACT_ID");
  return u;
}
