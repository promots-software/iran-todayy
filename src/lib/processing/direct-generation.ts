import {preparePublication,publicationUnits} from './direct-publication';
import {createHash} from 'node:crypto';
import {directArticleSchema,directGenerationSchema} from './direct-generation-contract';
import {EDITORIAL_CONTRACT_SHA256} from './editorial-contract';
import {ProcessingError,validateUnderstanding,type Understanding} from './contracts';
import {validateDirectExtraction} from './direct';
import {sourceLanguage} from './source-language';
import {newsroomPrefix} from './newsroom-format';
import {finalizeBodyPunctuation} from '../publication-finalization';
import {renderPublicationText,publicationParts} from '../publication-text';
import {literalQuotes,reason} from './editorial';

const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
// SourcePost IDs are assigned by the engine after extraction, never by the model.
const eventHash=(u:Understanding)=>hash(JSON.parse(JSON.stringify(u.event,(key,value)=>key==='sourcePostId'?undefined:value)));
export const directArticleInstructions='Reconstruct the complete ORIGINAL SOURCE as the final Arabic Iran Now article using the complete attached canonical contract. The source owner has already accepted editorial intake. Do not decide relevance, scope or whether human editorial review is needed. For Arabic, genuinely edit/rewrite rather than copy. For Persian/English, understand the full source and reconstruct natural Arabic, not sentence-by-sentence literal translation. Preserve source-supported facts, names, titles, attribution, numbers, dates, locations, quotes, negation and uncertainty. Never add outside facts or infer missing relationships. Return the complete title and body (empty body is allowed for a title-only FLASH), plus non-blocking diagnostic codes if useful. No self-certification of factual correctness. Never omit material content to fit or truncate the response. Writing rules come exclusively from the attached contract.';

/** Matching uses original-language literal evidence, not an editorial translation.
 * Failure here prevents establishing uniqueness; it is not editorial rejection. */
export function directMatchingUnderstanding(raw:unknown,source:string):Understanding{
 let x:ReturnType<typeof validateDirectExtraction>;
 try{x=validateDirectExtraction(raw,source);}catch(error){
  throw new ProcessingError('DIRECT_MATCH_INPUT_INVALID',false,error instanceof ProcessingError&&error.diagnostic?error.diagnostic:{stage:'extract',field:error instanceof ProcessingError?error.code:'schema',output:raw});
 }
 const e=x.extraction,c=x.classification;
 const copy=(v:typeof e.action)=>v?{key:v.excerpt.normalize('NFKC').toLowerCase().trim(),arabic:v.excerpt,evidence:{...v}}:null;
 return validateUnderstanding({language:sourceLanguage(source),relevance:'POLITICAL_NEWS',filterReason:'NONE',topic:'UNKNOWN',priority:c.priority,rationale:'المصدر معتمد للمعالجة المباشرة؛ النص الأصلي أساس المطابقة',sensitiveActor:c.sensitiveActor,leaderDeath:c.leaderDeath,seriousClaim:c.seriousClaim,rankUnverified:c.rankUnverified,names:[],uncoveredTerms:[],
  event:{actors:e.actors.map(v=>copy(v)!),action:copy(e.action),object:copy(e.object),location:copy(e.location),eventTime:null,summary:null,facts:e.statements.map((s,i)=>({id:s.id,key:s.evidence.excerpt.normalize('NFKC').toLowerCase().trim(),arabic:s.evidence.excerpt,evidence:{...s.evidence},speaker:copy(s.speaker),kind:c.factLabels[i].kind,material:c.factLabels[i].material,verified:false}))}},source);
}

export function directSourceGrounded(u:Understanding,source:string){
 try{validateUnderstanding(u,source);return u.event.facts.length>0&&[...u.event.actors,u.event.action,u.event.object,u.event.location,...u.event.facts,...u.event.facts.map(f=>f.speaker)].filter(v=>v!==null).every(v=>v.arabic===v.evidence.excerpt);}catch{return false;}
}
function usableArticle(raw:unknown){
 const p=directArticleSchema.safeParse(raw);
 if(!p.success)throw new ProcessingError('DIRECT_INVALID_ARTICLE_SCHEMA');
 const article=p.data;
 article.title=article.title.trim();article.body=article.body.trim();
 if(!article.title||!/[\u0621-\u064a]/u.test(article.title)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(article.title+article.body))throw new ProcessingError('DIRECT_CORRUPT_ARTICLE');
 if(article.body&&!/[\u0621-\u064a]/u.test(article.body))throw new ProcessingError('DIRECT_CORRUPT_ARTICLE');
 while(article.title.startsWith(newsroomPrefix))article.title=article.title.slice(newsroomPrefix.length).trim();
 if(!article.title)throw new ProcessingError('DIRECT_EMPTY_ARTICLE');
 article.body=publicationParts(article.title,article.body).body;
 article.title=newsroomPrefix+article.title;
 if(article.body)article.body=finalizeBodyPunctuation(article.body);
 else article.title=finalizeBodyPunctuation(article.title);
 if(renderPublicationText(article.title,article.body).length>4096)throw new ProcessingError('DIRECT_ARTICLE_DELIVERY_SIZE');
 return article;
}
export function completeDirectGeneration(raw:unknown,source:string,u:Understanding){
 if(!source.trim())throw new ProcessingError('SOURCE_TEXT_REQUIRED');
 const article=usableArticle(raw);
 const localDiagnostics:string[]=[];
 // Preserve local factual/coverage diagnostics without turning them into a
 // semantic attestation or an editorial routing requirement for DIRECT.
 try{
  const ids=u.event.facts.map(f=>f.id);
  const coverage=publicationUnits(source).map(unit=>({unitId:unit.id,nonFactual:false,factIds:ids}));
  preparePublication(source,u,{title:{text:article.title,factIds:ids},body:article.body?[{text:article.body,factIds:ids}]:[]},coverage);
 }catch(error){if(error instanceof ProcessingError)localDiagnostics.push(error.code);else throw error;}
 u.directGeneration={version:'direct-generation-v2',sourceHash:hash(source),articleHash:hash(article),eventHash:eventHash(u),editorialContractHash:EDITORIAL_CONTRACT_SHA256,article,localDiagnostics,semanticVerification:'DIAGNOSTIC_ONLY'};
 return directFinalArticle(source,u);
}
export function directFinalArticle(source:string,u:Understanding){
 const parsed=directGenerationSchema.safeParse(u.directGeneration);
 if(!parsed.success)throw new ProcessingError('DIRECT_GENERATION_RECEIPT_REQUIRED');
 const r=parsed.data;
 if(r.sourceHash!==hash(source)||r.articleHash!==hash(r.article)||r.eventHash!==eventHash(u)||r.editorialContractHash!==EDITORIAL_CONTRACT_SHA256||!directSourceGrounded(u,source))throw new ProcessingError('DIRECT_GENERATION_RECEIPT_CHANGED');
 const article=usableArticle(r.article);
 if(JSON.stringify(article)!==JSON.stringify(r.article))throw new ProcessingError('DIRECT_GENERATION_RECEIPT_CHANGED');
 const factIds=u.event.facts.map(f=>f.id);
 return {generationReceipt:r,title:article.title,body:article.body,format:article.body?'STANDARD_STORY' as const:'FLASH' as const,hashtags:[],protectedQuotes:literalQuotes(source),protectedSpans:[],applied:[],review:[...new Set([...article.diagnostics,...r.localDiagnostics])].map(d=>reason('FORMAT_REVIEW',d)),sentences:[{text:article.title,factIds},...(article.body?[{text:article.body,factIds}]:[])],sentenceEvidence:[{text:article.title,factIds},...(article.body?[{text:article.body,factIds}]:[])],provenanceKind:'SOURCE_LINK_NOT_SEMANTIC_ATTESTATION' as const};
}
