import type {GoldCase} from './schema';
import {requireArabic} from '../../../src/lib/processing/groq-validation';
export type Observation={title:string;body:string;sentences:{text:string;factIds:string[]}[];facts:{id:string;excerpt:string}[];disposition:string;relation:string;delivery:string;error?:string;review:string[]};
export type Finding={kind:'CRITICAL'|'QUALITY'|'TECHNICAL'|'UNVERIFIED';code:string;detail:string};
// Normalize marks/digit script for semantic probes, never protected quotations.
export const norm=(s:string)=>s.normalize('NFKC').replace(/[\u064b-\u065f\u0670]/gu,'').replace(/[٠-٩۰-۹]/gu,c=>String((c.charCodeAt(0)-(c<='٩'?0x660:0x6f0)))).replace(/\s+/gu,' ').trim();
const tokens=(s:string)=>norm(s).match(/[\p{L}\p{N}]+/gu)??[];
const has=(s:string,p:string)=>norm(s).includes(norm(p));
const escaped=(s:string)=>norm(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const attributed=(text:string,speaker:string)=>new RegExp('(?:قالت?|أعلنت?|أوضحت?|أضافت?|ذكرت?)\\s+'+escaped(speaker)+'(?:[^\\p{L}]|$)|'+escaped(speaker)+'\\s*[:：]|'+escaped(speaker)+'\\s+(?:قالت?|أعلنت?|أوضحت?|أضافت?|ذكرت?)(?:[^\\p{L}]|$)','u').test(norm(text));
/** Finite gold semantic predicates, not a universal Arabic equivalence oracle.
 * Novel unsupported vocabulary is UNVERIFIED, never silently accepted. */
export function evaluate(c:GoldCase,o:Observation){
 const findings:Finding[]=[];const add=(kind:Finding['kind'],code:string,detail='')=>findings.push({kind,code,detail});
 if(o.error){add('TECHNICAL',o.error,'Pipeline stopped; no publication output.');return findings;}
 if(o.relation!==c.relation.kind)add('CRITICAL','DUPLICATE_UPDATE_DECISION',`${o.relation} != ${c.relation.kind}`);
 if(o.delivery!=='HOLD')add('CRITICAL','UNSAFE_DELIVERY');
 if(o.disposition!==c.expectedDisposition)add('QUALITY','DISPOSITION_MISMATCH',`${o.disposition} != ${c.expectedDisposition}`);
 if(o.disposition==='DUPLICATE')return findings;
 // A withheld draft is not seven fabricated semantic errors. Report the actual
 // decision disagreement, and do not score nonexistent text as an omission.
 if(o.relation==='UNCERTAIN_MATCH'&&!o.title&&!o.body)return findings;
 const text=o.title+'\n'+o.body;
 try{requireArabic(text);}catch{add('QUALITY','OUTPUT_NOT_ARABIC');}
 const ids=new Set(c.expectedCoverage),seen=new Set<string>();
 for(const f of o.facts){if(!ids.has(f.id)||c.materialFacts.find(g=>g.id===f.id)?.sourceExcerpt!==f.excerpt)add('CRITICAL','EVIDENCE_CHANGED',f.id);}
 for(const s of o.sentences){
  if(!s.factIds.length||s.factIds.some(id=>!ids.has(id)))add('TECHNICAL','INVALID_EVIDENCE_ID');
  s.factIds.forEach(id=>seen.add(id));
  if(!text.includes(s.text))add('TECHNICAL','PROVENANCE_TEXT_MISMATCH');
  const linked=c.materialFacts.filter(f=>s.factIds.includes(f.id));
  // Where the gold establishes a simple subject/action/object clause, enforce
  // those roles in either VSO or SVO order; a bag of the same words is not proof.
  const actor=c.replay.anchorArabic[c.replay.actors[0]]??c.replay.actors[0];
  const action=c.replay.anchorArabic[c.replay.action]??c.replay.action;
  const object=c.replay.anchorArabic[c.replay.object]??c.replay.object;
  for(const f of linked){
   const verbs=f.predicates.find(p=>p.anyOf.includes(action))?.anyOf??[action];
   const verb='(?:'+verbs.map(escaped).join('|')+')',subject=escaped(actor),target=escaped(object);
   const pattern=new RegExp('(?:'+verb+'\\s+'+subject+'|'+subject+'\\s+'+verb+')\\s+.*?'+target,'u');
   if(pattern.test(norm(f.meaning))&&!pattern.test(norm(s.text)))add('CRITICAL','ENTITY_RELATIONSHIP_CHANGED',f.id);
  }
  // Sentence-local vocabulary prevents laundering another fact through valid IDs.
  const allowed=new Set(tokens(linked.map(f=>f.meaning+' '+f.predicates.flatMap(p=>p.anyOf).join(' ')).join(' ')+' إيران الآن | إن أن في من على إلى عن مع و ثم وقد كما قالت قال أعلنت أعلن'));
  const unknown=[...new Set(tokens(s.text).filter(t=>!allowed.has(t)))];
  if(unknown.length)add('UNVERIFIED','UNRECOGNIZED_SEMANTIC_WORDING',unknown.join(' '));
  for(const name of c.requiredAttributions){if(linked.some(f=>attributed(f.meaning,name))&&!attributed(s.text,name))add('CRITICAL','ATTRIBUTION_CHANGED',name);}
 }
 if(!o.sentences.some(s=>s.text===o.title)||o.body.split('\n').filter(Boolean).some(s=>!o.sentences.some(p=>p.text===s)))add('TECHNICAL','UNMAPPED_SENTENCE');
 for(const f of c.materialFacts){
  const lines=o.sentences.filter(s=>s.factIds.includes(f.id));
  if(!seen.has(f.id)||!o.facts.some(x=>x.id===f.id))add('CRITICAL','MATERIAL_OMISSION',f.id);
  // Each predicate must survive in one linked sentence, not unrelated copy.
  if(f.predicates.some(p=>!lines.some(s=>p.anyOf.some(a=>has(s.text,a)))))add('CRITICAL','FACT_MEANING_MISSING_OR_CHANGED',f.id);
 }
 for(const [key,code] of [['requiredAttributions','ATTRIBUTION_CHANGED'],['requiredNumbers','NUMBER_CHANGED'],['requiredDates','DATE_CHANGED'],['requiredLocations','LOCATION_CHANGED'],['requiredEntities','ENTITY_CHANGED'],['requiredModalities','MODALITY_OR_NEGATION_CHANGED'],['requiredConditions','CONDITION_CHANGED']] as const){
  for(const v of c[key])if(!has(text,v))add('CRITICAL',code,v);
 }
 const outputNumbers:string[]=norm(text).match(/\d+(?:[.,]\d+)*/gu)??[],sourceNumbers:string[]=norm(c.materialFacts.map(f=>f.meaning).join(' ')).match(/\d+(?:[.,]\d+)*/gu)??[];
 if(outputNumbers.some(n=>!sourceNumbers.includes(n)))add('CRITICAL','UNSUPPORTED_NUMBER');
 for(const q of c.requiredQuotes)if(!text.includes(q))add('CRITICAL','QUOTE_CHANGED',q);
 for(const q of text.match(/«[^»]*»|“[^”]*”|"[^"\n]*"/gu)??[])if(!c.sourceText.includes(q))add('CRITICAL','INVENTED_QUOTE');
 for(const p of c.forbiddenAdditions)if(has(text,p))add('CRITICAL','FORBIDDEN_ADDITION',p);
 // Added semantic operators are unsafe even when their vocabulary is familiar.
 for(const marker of ['بسبب','لذلك','حتماً','بالتأكيد','لم','لن','قد','ربما']){
  const pattern=new RegExp('(?:^|[^\\p{L}])(?:و)?'+norm(marker)+'(?=$|[^\\p{L}])','u');
  if(pattern.test(norm(text))&&!pattern.test(norm(c.materialFacts.map(f=>f.meaning).join(' '))))add('CRITICAL','UNSUPPORTED_SEMANTIC_OPERATOR',marker);
 }
 if((text.match(/إيران الآن/g)??[]).length!==1)add('QUALITY','BRANDING');
 if(/[:：]\s*$/u.test(o.title))add('QUALITY','ATTRIBUTION_ONLY_HEADLINE');
 if(/قال (?:وزارة|هيئة|بلدية)/u.test(text))add('QUALITY','ARABIC_GENDER_AGREEMENT');
 if(o.sentences.some(s=>c.requiredAttributions.some(a=>s.text.split(a).length>2)&&/(?:في إفادته|في إفادتها)/u.test(s.text)))add('QUALITY','REPEATED_ATTRIBUTION');
 if(/(?:^|\s)(?:رح|هلأ|الجاي|عم تنعمل|وبعدين)(?:\s|$)/u.test(text))add('QUALITY','AWKWARD_ARABIC');
 if(c.styleCharacteristics.includes('rewrite-required')&&norm(text.replace('إيران الآن | ',''))===norm(c.sourceText))add('QUALITY','REWRITE_REQUIRED');
 if(o.body&&norm(o.body)===norm(o.title.replace('إيران الآن | ','')))add('QUALITY','DUPLICATED_STORY');
 if(!c.sourceText.includes('عاجل')&&text.includes('عاجل'))add('QUALITY','SENSATIONALISM');
 return findings;
}
