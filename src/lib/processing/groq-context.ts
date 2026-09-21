import type { ruleSet } from "./rules";
import { z } from "zod";
import type { Stage } from "./openai";
import { structuredSchema } from "./openai";
import {coverageInstructions} from './editorial-scope';

/** Strict structure on the wire; all value/format constraints remain enforced by local Zod. */
export function groqSchema(stage: Stage, contract?: z.ZodType) {
  const schema=contract ? z.toJSONSchema(contract) : structuredSchema(stage);
  function visit(value:unknown):void {
    if(!value||typeof value!=="object")return;
    if(Array.isArray(value)){value.forEach(visit);return;}
    const node=value as Record<string,unknown>;
    delete node.$schema;
    if(node.properties && typeof node.properties === "object") {
      const properties=node.properties as Record<string,unknown>;
      delete properties.sourcePostId;
      if ('excerpt' in properties) properties.context={type:'string',description:'Verbatim surrounding source text identifying this excerpt exactly once within a unique source context. Include enough context to disambiguate repeated excerpts.'};
      // Property names are user data, not schema keywords (e.g. a field named format).
      Object.values(properties).forEach(visit);
      node.required=Object.keys(properties);node.additionalProperties=false;
    }
    for(const key of ["minLength","maxLength","pattern","format","minimum","maximum","exclusiveMinimum","exclusiveMaximum","multipleOf","minItems","maxItems"])delete node[key];
    for(const [key,child] of Object.entries(node)) {
      if(key === "properties") continue;
      if(key === "$defs" || key === "definitions" || key === "patternProperties") {
        if(child && typeof child === "object") Object.values(child).forEach(visit);
      } else if(key === "items" || key === "additionalProperties" || key === "anyOf" || key === "oneOf" || key === "allOf" || key === "not" || key === "prefixItems") visit(child);
    }
  }
  visit(schema);return schema;
}

/** Stage-specific context, not new policy. Rewriting still receives every editorial rule. */
export function groqRuleContext(stage: Stage, rules: typeof ruleSet) {
  if (stage === "compare") return {version:rules.version,duplicateWindowHours:rules.duplicateWindowHours};
  if (stage === "understand") return {version:rules.version,coverageVersion:'six-geographies-v1',policy:rules.policy.filter(r=>["FILTER","PRIORITY","SOURCES","TITLES","CREDIBILITY"].includes(r.id)).map(r=>r.id==='FILTER'?{...r,reference:'User coverage override six-geographies-v1; original safety exclusions retained',instruction:coverageInstructions+' Exclude advertising, satire, unidentifiable rumours, personal opinion without an approved analyst, and incitement without independent news value. Approved analysis is context, not breaking news.'}:r),names:rules.names,reviewReasons:rules.reviewReasons,ambiguities:rules.ambiguities};
  return {version:rules.version,pipelineOrder:rules.pipelineOrder,policy:rules.policy.map(({id,instruction})=>({id,instruction})),
    // instruction repeats from/to; category/reference are provenance, not operative requirements.
    terminology:rules.terminology.map(({id,mode,from,to,condition})=>({id,mode,from,to,condition})),names:rules.names,ambiguities:rules.ambiguities,externalPublishingEnabled:false};
}

/** DIRECT replaces only scope/priority policy, retaining source and claim safety. */
export function directRuleContext(rules:typeof ruleSet) {
 return {version:rules.version,policy:rules.policy.filter(r=>['SOURCES','TITLES','CREDIBILITY'].includes(r.id)),names:rules.names,reviewReasons:rules.reviewReasons,ambiguities:rules.ambiguities};
}
