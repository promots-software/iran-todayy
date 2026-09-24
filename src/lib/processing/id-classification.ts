import {z} from 'zod';
import {ProcessingError,understandingSchema,validateUnderstanding,type Understanding,type SourceProfile} from './contracts';
import {validateGroundedExtraction,type GroundedExtraction} from './groq-extraction';
import {requireArabic,sourceLanguage,validateExtractionLanguageAndSpeakers} from './groq-validation';

import {names} from './rules';
import {resolveRendering,type RenderingReference} from './evidence-rendering';
import type {RenderingReceipt} from './rendering-contract';

type Evidence=GroundedExtraction['actors'][number];
type Entry={id:string;role:string;evidence:Evidence};
export function classificationReferences(x:GroundedExtraction){
 const anchors:Entry[]=x.actors.map((e,i)=>({id:`actor:${i+1}`,role:'actor',evidence:e}));
 for(const role of ['action','object','location','event_time'] as const)if(x[role])anchors.push({id:role,role,evidence:x[role]});
 for(const f of x.statements)if(f.speaker)anchors.push({id:`${f.id}:speaker`,role:'speaker',evidence:f.speaker});
 const facts:Entry[]=x.statements.map(f=>({id:f.id,role:'fact',evidence:f.evidence}));
 const entries=[...anchors,...facts];
 if(new Set(entries.map(e=>e.id)).size!==entries.length)throw new ProcessingError('DUPLICATE_EXTRACTION_ID');
 return {entries,requiredAnchorIds:anchors.map(e=>e.id),requiredFactIds:facts.map(e=>e.id)};
}
export function idClassificationSchema(x:GroundedExtraction){
 const refs=classificationReferences(x);
 const ids=refs.entries.map(e=>e.id);
 const array=(values:string[])=>z.array(values.length?z.enum(values):z.string()).length(values.length);
 // A source-attributed factual report remains FACT; attribution is a separate,
 // immutable evidence relationship. CLAIM/STATEMENT still require a speaker.
 const factLabels=x.statements.map(f=>z.object({id:z.literal(f.id),kind:f.speaker?z.enum(['FACT','CLAIM','STATEMENT','FIGURE','DECISION','OUTCOME']):z.enum(['FACT','FIGURE','DECISION','OUTCOME']),material:z.boolean()}).strict());
 return z.object({
  anchorIds:array(refs.requiredAnchorIds),
  factLabels:z.array(factLabels.length>1?z.union(factLabels):factLabels[0]??z.object({id:z.string(),kind:z.literal('FACT'),material:z.boolean()}).strict()).length(x.statements.length),
  filterReason:z.enum(['NONE','UNRELATED','ADVERTISING','SATIRE','RUMOUR','OPINION','INCITEMENT']),
  topic:understandingSchema.shape.topic,
  topicEvidenceId:ids.length?z.enum(ids).nullable():z.null(),
  priority:understandingSchema.shape.priority,
  sensitiveActor:z.boolean(),leaderDeath:z.boolean(),seriousClaim:z.boolean(),rankUnverified:z.boolean(),
  rationaleIds:z.array(ids.length?z.enum(ids):z.string()).min(ids.length?1:0).max(ids.length),
 }).strict();
}
export const idClassificationInstructions='Classify only the supplied immutable references. Return IDs and classification labels only; never return factual text, translations, entities, names, speakers, roles, relationships, evidence, semantic keys or prose rationale. Include every required factId exactly once in factLabels and every required anchorId exactly once in anchorIds. Select rationaleIds supporting the labels, including topicEvidenceId when non-null; the Arabic rationale is rendered locally. Relevance is already validated and cannot be changed. Select UNKNOWN when a specific topic is not established. A generic regional expression never establishes a named region. Every non-UNKNOWN topic requires topicEvidenceId identifying supplied evidence explicitly supporting that topic (including non-geographical topics). UNKNOWN may use null. Do not infer nationality, country, institution identity, speaker, ownership, affiliation or relationships from a name, source, catalogue or project identity. Facts and their speaker structure are copied locally, never reclassified as attributed speech without a validated speaker. Ordinary factual narration is FACT, not STATEMENT. Classify serious claims and sensitive actors accurately; labels alone are not editorial failures. A faithfully copied sourced title is not an inferred title. Flag rankUnverified only for unresolved rank identity, not merely absence of external verification. Do not attest editorial correctness.';
export function idClassificationInput(x:GroundedExtraction,profile:SourceProfile){
 const refs=classificationReferences(x);
 return {classificationReferences:{...refs,relevance:x.relevance,
  // Trust status controls review, never factual identity.
  sourceReview:{verified:profile.verified,flagged:profile.flagged,approvedAnalyst:profile.approvedAnalyst}}};
}
/** Classifier output cannot supply any text to these local factual copies. */
function copy(id:string,e:Evidence|null,translations:Map<string,string>|null){
 if(!e)return null;
 const arabic=translations?.get(id)??e.excerpt;if(translations)requireArabic(arabic);
 const label={key:e.excerpt.normalize('NFKC').toLowerCase().trim(),arabic};
 return {key:label.key,arabic,evidence:{...e}};
}
function renderingReferences(x:GroundedExtraction):RenderingReference[]{return classificationReferences(x).entries.filter(e=>e.role!=='event_time');}
export function preflightIdClassification(x:GroundedExtraction,source:string,rendering?:RenderingReceipt){
 validateGroundedExtraction(x,source);
 const language=sourceLanguage(source);
 if(language==='unknown')throw new ProcessingError('SOURCE_LANGUAGE_UNCERTAIN');
 if(language==='ar')return null;
 return resolveRendering(source,renderingReferences(x),rendering);
}
export function adaptIdClassification(x:GroundedExtraction,raw:unknown,source:string,rendering?:RenderingReceipt):Understanding{
 const translations=preflightIdClassification(x,source,rendering);
 const parsed=idClassificationSchema(x).safeParse(raw);
 if(!parsed.success)throw new ProcessingError('INVALID_ID_CLASSIFICATION');
 const c=parsed.data,refs=classificationReferences(x);
 const sameIds=(actual:string[],required:string[])=>actual.length===required.length&&new Set(actual).size===required.length&&required.every(id=>actual.includes(id));
 if(!sameIds(c.anchorIds,refs.requiredAnchorIds)||!sameIds(c.factLabels.map(f=>f.id),refs.requiredFactIds))throw new ProcessingError('CLASSIFICATION_EVIDENCE_MISMATCH');
 if(new Set(c.rationaleIds).size!==c.rationaleIds.length)throw new ProcessingError('INVALID_CLASSIFICATION_RATIONALE_IDS');
 if(c.topicEvidenceId&&!c.rationaleIds.includes(c.topicEvidenceId))throw new ProcessingError('INVALID_CLASSIFICATION_RATIONALE_IDS');
 const selected=refs.entries.find(e=>e.id===c.topicEvidenceId);
 if(c.topic!=='UNKNOWN'&&!selected)throw new ProcessingError('CLASSIFICATION_TOPIC_EVIDENCE_INVALID');
 const rationale=c.topic==='UNKNOWN'
  ?`لم يثبت موضوع محدد من الأدلة المعتمدة؛ المراجع: ${c.rationaleIds.join('، ')}`
  :`التصنيف مستند إلى الأدلة المعتمدة في المراجع: ${c.rationaleIds.join('، ')}`;
 requireArabic(rationale);
 const knownNames:Understanding['names']=[],uncoveredTerms:string[]=[];
 for(const e of [...x.actors,...x.statements.flatMap(f=>f.speaker?[f.speaker]:[])]){
  const kind=names.people.includes(e.excerpt)?'person':names.places.includes(e.excerpt)?'place':names.institutions.includes(e.excerpt)?'institution':null;
  const entry=refs.entries.find(r=>r.evidence.start===e.start&&r.evidence.end===e.end)!;
  const arabic=translations?.get(entry.id)??e.excerpt;
  if(kind)knownNames.push({arabic,kind,evidence:{...e}});
  // An unlisted entity stays an immutable anchor; dictionary membership is not
  // proof of identity. Do not invent its type or a terminology defect.
 }
 if(x.location)knownNames.push({arabic:translations?.get('location')??x.location.excerpt,kind:'place',evidence:{...x.location}});
 const literal=x.event_time?.excerpt;
 const iso=literal&&z.iso.datetime({offset:true}).safeParse(literal).success?new Date(literal).toISOString():null;
 const u:Understanding={language:sourceLanguage(source),relevance:x.relevance,filterReason:c.filterReason,topic:c.topic,priority:c.priority,rationale,
  sensitiveActor:c.sensitiveActor,leaderDeath:c.leaderDeath,seriousClaim:c.seriousClaim,rankUnverified:c.rankUnverified,
  names:knownNames,uncoveredTerms:[...new Set(uncoveredTerms)],...(rendering?{rendering}:{}),
  event:{actors:x.actors.map((e,i)=>copy(`actor:${i+1}`,e,translations)!),action:copy('action',x.action,translations),object:copy('object',x.object,translations),location:copy('location',x.location,translations),eventTime:iso&&x.event_time?{iso,evidence:{...x.event_time}}:null,summary:null,
   facts:x.statements.map(f=>{const labels=c.factLabels.find(l=>l.id===f.id)!;return {id:f.id,key:f.evidence.excerpt.normalize('NFKC').toLowerCase().trim(),arabic:translations?.get(f.id)??f.evidence.excerpt,evidence:{...f.evidence},
    kind:labels.kind,speaker:copy(`${f.id}:speaker`,f.speaker,translations),material:labels.material,verified:false};})}};
 validateUnderstanding(u,source);validateExtractionLanguageAndSpeakers(u,source);
 return u;
}
