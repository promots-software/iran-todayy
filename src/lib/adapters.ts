// Legacy Phase 1 contracts retained for compatibility. The executable Phase 2
// contracts are in processing/contracts.ts; do not use these for new adapters.
export interface IncomingPost {
  externalId: string;
  url: string;
  content: string;
  publishedAt: Date;
}
export interface MonitoringAdapter {
  poll(input: { handle: string; cursor: unknown; signal: AbortSignal }): Promise<{
    posts: IncomingPost[]; cursor: unknown; retryAfterMs?: number;
  }>;
}
export interface FactEvidence {
  fact: string;
  sourcePostId: string;
  sourceExcerpt: string;
}
export interface EventUnderstanding {
  language: string;
  relevance: "POLITICAL_NEWS" | "IRRELEVANT" | "UNCERTAIN";
  facts: FactEvidence[];
  protectedQuotes: { text: string; sourcePostId: string }[];
  reviewReasons: string[];
}
export interface AiAdapter {
  understand(posts: IncomingPost[], signal: AbortSignal): Promise<EventUnderstanding>;
  embed(facts: FactEvidence[], signal: AbortSignal): Promise<{ vector: number[]; model: string }>;
  draftArabic(input: EventUnderstanding, rules: EditorialRules, signal: AbortSignal): Promise<{ content: string; evidence: FactEvidence[]; reviewReasons: string[] }>;
}
export interface EditorialRules {
  version: string;
  provenance: { document: string; page?: number }[];
  automaticTerminology: { from: string; to: string; excludeLiteralQuotes: true }[];
  contextualTerminology: unknown[];
  attribution: unknown[];
  namesAndTransliteration: unknown[];
  titlesAndRanks: unknown[];
  numbersDatesPunctuation: unknown[];
  quoteProtection: unknown[];
  credibility: unknown[];
  forbiddenTerminology: unknown[];
  needsReview: unknown[];
}
export interface PublishingAdapter {
  // An idempotency key is local intent, not a promise of upstream exactly-once delivery.
  // UNKNOWN must be reconciled by an operator; never automatically resend it.
  send(input: { content: string; idempotencyKey: string; signal: AbortSignal }): Promise<
    { status: "SENT"; messageId: string; result: unknown } |
    { status: "FAILED"; error: string; retryAfterMs?: number } |
    { status: "UNKNOWN"; error: string }
  >;
}
