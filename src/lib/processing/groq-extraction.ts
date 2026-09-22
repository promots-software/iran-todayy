
import { z } from 'zod';
import {validateSpeakerEvidence} from './speaker-evidence';
import { checkEvidence, evidenceSchema, ProcessingError, understandingSchema, validateUnderstanding, type Understanding } from './contracts';
import { resolveContextEvidence, requireArabic, validateExtractionLanguageAndSpeakers } from './groq-validation';
import {validateTopicGrounding,validateInstitutionGrounding,validateNoCountryAddition,validateRationaleGrounding,normalizeInstitutionIdentity,supportedClassificationTopics} from './classification-grounding';

const text=z.string().min(1).max(20000);
const evidence=z.object({excerpt:text,context:text}).strict();
// Model output contains only source spans; no generated facts, summary, IDs or offsets.
export const minimalExtractionSchema=z.object({
  relevance:understandingSchema.shape.relevance,
  actors:z.array(evidence).max(30),action:evidence.nullable(),object:evidence.nullable(),
  location:evidence.nullable(),event_time:evidence.nullable(),
  statements:z.array(z.object({evidence:evidence.describe('A complete contiguous verbatim factual assertion from source prose, not merely an actor/action anchor.'),speaker:evidence.nullable().describe('Explicit speaker only; null for unattributed factual narration. No inferred speaker.')}).strict()).max(100).describe('Mandatory factual assertions when safely present in POLITICAL_NEWS, including ordinary narration. Anchors do not satisfy this field. [] only when no safe source assertion exists; completeness validation remains strict.'),
}).strict();
type Evidence=z.infer<typeof evidenceSchema>;
export function validateMinimalExtraction(raw:unknown,source:string){
  const p=minimalExtractionSchema.safeParse(raw);
  if(!p.success)throw new ProcessingError('GROQ_INVALID_SCHEMA');
  let field='schema';
  try{
  const resolve=(value:z.infer<typeof evidence>|null,path:string,locationActors?:Evidence[]):Evidence|null=>{
    field=path;
    if(!value)return null;
    const copy={...value};resolveContextEvidence(copy,source,locationActors);
    const result=evidenceSchema.parse(copy);checkEvidence(source,result);return result;
  };
  const x=p.data;
  const actors=x.actors.map((e,i)=>resolve(e,`actors.${i}`)!);
  const result={relevance:x.relevance,actors,action:resolve(x.action,'action'),object:resolve(x.object,'object'),location:resolve(x.location,'location',actors),event_time:resolve(x.event_time,'event_time'),
    statements:x.statements.map((s,i)=>({id:`f${i+1}`,evidence:resolve(s.evidence,`statements.${i}.evidence`)!,speaker:resolve(s.speaker,`statements.${i}.speaker`)}))};
  for(const s of result.statements){
    if(!s.speaker)continue;
    field=`statements.${s.id}.speaker`;
    validateSpeakerEvidence(source,s.evidence,s.speaker);
  }
  return result;
  }catch(error){
    // Only schema-checked extraction data, never transport envelopes or headers.
    if(error instanceof ProcessingError&&JSON.stringify(p.data).length<=120000)throw new ProcessingError(error.code,error.retryable,{stage:'extract',field,output:p.data});
    throw error;
  }
}
export type GroundedExtraction=ReturnType<typeof validateMinimalExtraction>;
export function requireCompleteExtraction(x:GroundedExtraction,source?:string){
  void source;
  // Missing optional event anchors are not evidence of a factual defect.
  // Exact assertions, speaker scope and downstream fidelity remain mandatory.
  if(x.relevance!=='IRRELEVANT' && !x.statements.length)throw new ProcessingError('INCOMPLETE_EXTRACTION');
}
// Semantic keys and Arabic translations are downstream classification, not evidence.
const label=z.object({key:text,arabic:text,nameKind:z.enum(['person','place','institution']).nullable()}).strict();
export const semanticClassificationSchema=understandingSchema.pick({filterReason:true,topic:true,priority:true,rationale:true,sensitiveActor:true,leaderDeath:true,seriousClaim:true,rankUnverified:true,uncoveredTerms:true}).extend({
  topicEvidence:text.nullable(),
  actors:z.array(label),action:label.nullable(),object:label.nullable(),location:label.nullable(),
  statements:z.array(z.object({id:text,key:text,arabic:text,kind:z.enum(['FACT','CLAIM','FIGURE','DECISION','OUTCOME','STATEMENT']),material:z.boolean(),speaker:label.nullable()}).strict()),
}).strict();

function extractedExcerpts(x:GroundedExtraction){
  return [...x.actors,x.action,x.object,x.location,x.event_time,...x.statements.map(s=>s.evidence),...x.statements.map(s=>s.speaker)].filter((e):e is Evidence=>e!==null).map(e=>e.excerpt);
}
/** Classification labels existing evidence; it cannot delete or manufacture anchors. */
export function classificationSchemaFor(x:GroundedExtraction){
  const topics=supportedClassificationTopics(understandingSchema.shape.topic.options,extractedExcerpts(x));
  const statement=semanticClassificationSchema.shape.statements.element;
  const statements=x.statements.map(s=>statement.extend({id:z.literal(s.id),speaker:s.speaker?label:z.null()}));
  return semanticClassificationSchema.extend({
    topic:z.enum(topics),
    actors:z.array(label).length(x.actors.length),
    action:x.action?label:z.null(),object:x.object?label:z.null(),location:x.location?label:z.null(),
    statements:z.array(statements.length===0?statement:statements.length===1?statements[0]:z.union(statements)).length(x.statements.length),
  });
}
export function validateGroundedExtraction(x:GroundedExtraction,source:string){
  requireCompleteExtraction(x,source);
  for(const e of [...x.actors,x.action,x.object,x.location,x.event_time,...x.statements.map(s=>s.evidence),...x.statements.map(s=>s.speaker)])if(e)checkEvidence(source,e);
  for(const s of x.statements)if(s.speaker)validateSpeakerEvidence(source,s.evidence,s.speaker);
}

export function adaptClassification(x:GroundedExtraction,raw:unknown,source:string,language:string):Understanding {
  const p=semanticClassificationSchema.safeParse(raw);
  if(!p.success)throw new ProcessingError('GROQ_INVALID_SCHEMA');
  const c=p.data,names:Understanding['names']=[];
  const excerpts=extractedExcerpts(x);
  requireArabic(c.rationale);
  validateTopicGrounding(c.topic,c.topicEvidence,excerpts);
  validateRationaleGrounding(c.rationale,excerpts);
  function supported(e:Evidence|null,l:z.infer<typeof label>|null){
    if((e===null)!==(l===null))throw new ProcessingError('CLASSIFICATION_EVIDENCE_MISMATCH');
    if(!e||!l)return null;
    l=normalizeInstitutionIdentity(e.excerpt,l) as typeof l;
    requireArabic(l.arabic);
    validateInstitutionGrounding(e.excerpt,l.arabic,l.nameKind);
    validateNoCountryAddition(l.arabic,excerpts);
    if(l.nameKind)names.push({arabic:l.arabic,kind:l.nameKind,evidence:e});
    return {key:l.key,arabic:l.arabic,evidence:e};
  }
  if(c.actors.length!==x.actors.length||c.statements.length!==x.statements.length)throw new ProcessingError('CLASSIFICATION_EVIDENCE_MISMATCH');
  const facts=x.statements.map((s,i)=>{
    const f=c.statements[i];
    if(f.id!==s.id)throw new ProcessingError('CLASSIFICATION_EVIDENCE_MISMATCH');
    requireArabic(f.arabic);
    validateNoCountryAddition(f.arabic,[s.evidence.excerpt,...(s.speaker?[s.speaker.excerpt]:[])]);
    if((f.kind==='CLAIM'||f.kind==='STATEMENT')&&!s.speaker)throw new ProcessingError('SPEAKER_ATTRIBUTION_REQUIRED');
    return {id:s.id,key:f.key,arabic:f.arabic,kind:f.kind,material:f.material,speaker:supported(s.speaker,f.speaker),evidence:s.evidence,verified:false};
  });
  // A full literal ISO timestamp is safely parseable without adding a missing date/time/zone.
  const literal=x.event_time?.excerpt;
  const iso=literal&&z.iso.datetime({offset:true}).safeParse(literal).success?new Date(literal).toISOString():null;
  const u:Understanding={language,relevance:x.relevance,filterReason:c.filterReason,topic:c.topic,priority:c.priority,rationale:c.rationale,
    sensitiveActor:c.sensitiveActor,leaderDeath:c.leaderDeath,seriousClaim:c.seriousClaim,rankUnverified:c.rankUnverified,uncoveredTerms:c.uncoveredTerms,names,
    event:{actors:x.actors.map((e,i)=>supported(e,c.actors[i])!),action:supported(x.action,c.action),object:supported(x.object,c.object),location:supported(x.location,c.location),
      eventTime:iso&&x.event_time?{iso,evidence:x.event_time}:null,facts,summary:null}};
  requireArabic(u.rationale);
  validateUnderstanding(u,source);validateExtractionLanguageAndSpeakers(u,source);
  return u;
}
