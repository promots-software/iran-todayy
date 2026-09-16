import { createHash } from "node:crypto";
import { ProcessingError, type LanguageProvider, type Monitor, type Incoming, type Comparison, type EventData } from "./contracts";
export const contentKey = (content:string)=>createHash("sha256").update(content).digest("hex");
export type FixtureRecord = { content: string; understanding: unknown; draft: unknown };
/** Explicit fixture transport: unknown inputs fail closed; never masquerades as live NLP. */
export class FixtureLanguageProvider implements LanguageProvider {
  readonly id="fixture-language-v1";
  readonly live=false;
  private records:Map<string,FixtureRecord>;
  constructor(records:FixtureRecord[], private compareFixture:(a:EventData,b:EventData)=>Comparison) { this.records=new Map(records.map(r=>[contentKey(r.content),r])); }
  async understand(input:{content:string}) { const r=this.records.get(contentKey(input.content));if (!r) throw new ProcessingError("FIXTURE_NOT_FOUND");return structuredClone(r.understanding); }
  async draft(input:{content:string}) { const r=this.records.get(contentKey(input.content));if (!r) throw new ProcessingError("FIXTURE_NOT_FOUND");return structuredClone(r.draft); }
  async compare(input:{incoming:EventData;existing:EventData}) { return this.compareFixture(input.incoming,input.existing); }
}
export class FixtureMonitor implements Monitor {
  readonly id="fixture-monitor-v1"; readonly live=false;
  constructor(private postsByHandle:Record<string,Incoming[]>) {}
  async poll(input:{handle:string;cursor:unknown}) { const posts=this.postsByHandle[input.handle]??[];const cursor=typeof input.cursor === "number"?input.cursor:0;return {posts:posts.slice(cursor),cursor:posts.length}; }
}
export class UnconfiguredLanguageProvider implements LanguageProvider {
  readonly id="unconfigured"; readonly live=false;
  async understand():Promise<never> {throw new ProcessingError("PROVIDER_UNAVAILABLE");}
  async compare():Promise<never> {throw new ProcessingError("PROVIDER_UNAVAILABLE");}
  async draft():Promise<never> {throw new ProcessingError("PROVIDER_UNAVAILABLE");}
}
/** Deliberately no publisher implementation or credentials in Phase 2. */
export function externalPublicationDecision() { return {allowed:false,reason:"PHASE2_EXTERNAL_PUBLISHING_DISABLED"} as const; }
