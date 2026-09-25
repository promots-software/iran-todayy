import {validatePropositionBinding} from './proposition-binding';
import {validateFidelityLedger} from './fidelity-ledger';
import {normalizeGeneratedArabic} from './targeted-repair';
import {structurallyEqual,stableJson} from './structural-integrity';
import {validateObjectiveArticle,validatePublicationReviewProtocol} from './direct-publication';
import {factualReviewPassed,isSoftReviewIssue} from './rendering-contract';
import {createHash} from 'node:crypto';
import {directArticleSchema,directGenerationSchema,directMatchingReviewSchema} from './direct-generation-contract';
import {EDITORIAL_CONTRACT_SHA256} from './editorial-contract';
import {ProcessingError,validateUnderstanding,type Understanding} from './contracts';
import {validateDirectExtraction} from './direct';
import {sourceInputLanguage as sourceLanguage} from './source-language';
import {newsroomPrefix} from './newsroom-format';
import {finalizeBodyPunctuation} from '../publication-finalization';
import {renderPublicationText,publicationParts} from '../publication-text';
import {literalQuotes,reason} from './editorial';

const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
// SourcePost IDs are assigned by the engine after extraction, never by the model.
const structuralHash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:stableJson(v)).digest('hex');
const eventHash=(u:Understanding,digest=hash)=>digest(JSON.parse(JSON.stringify(u.event,(key,value)=>key==='sourcePostId'?undefined:value)));
export const directArticleInstructions='Reconstruct the complete ORIGINAL SOURCE as the final Arabic Iran Now article using the complete attached canonical contract. Generate only after the separate semantic intake fields accept usable Iran-related news; do not override that decision or decide human review. For Arabic, genuinely edit/rewrite rather than copy. For Persian/English, understand the full source and reconstruct natural Arabic, not sentence-by-sentence literal translation. Preserve source-supported facts, names, titles, attribution, numbers, dates, locations, quotes, negation and uncertainty. Never add outside facts or infer missing relationships. Return the complete title and body (empty body is allowed for a title-only FLASH), plus non-blocking diagnostic codes if useful. No self-certification of factual correctness. Never omit material content to fit or truncate the response. Writing rules come exclusively from the attached contract.';

/** Matching uses original-language literal evidence, not an editorial translation.
 * Failure here prevents establishing uniqueness; it is not editorial rejection. */
export function directMatchingUnderstanding(raw:unknown,source:string,deferToIndependentReview=false):Understanding{
 let x:ReturnType<typeof validateDirectExtraction>;
 try{x=validateDirectExtraction(raw,source,deferToIndependentReview);}catch(error){
  throw new ProcessingError('DIRECT_MATCH_INPUT_INVALID',false,error instanceof ProcessingError&&error.diagnostic?error.diagnostic:{stage:'extract',field:error instanceof ProcessingError?error.code:'schema',output:raw});
 }
 const e=x.extraction,c=x.classification;
 const copy=(v:typeof e.action)=>v?{key:v.excerpt.normalize('NFKC').toLowerCase().trim(),arabic:v.excerpt,evidence:{...v}}:null;
 return validateUnderstanding({semanticCoverage:x.coverage,language:sourceLanguage(source),relevance:'POLITICAL_NEWS',filterReason:'NONE',topic:'UNKNOWN',priority:c.priority,rationale:'المصدر معتمد للمعالجة المباشرة؛ النص الأصلي أساس المطابقة',sensitiveActor:c.sensitiveActor,leaderDeath:c.leaderDeath,seriousClaim:c.seriousClaim,rankUnverified:c.rankUnverified,names:[],uncoveredTerms:[],
  event:{actors:e.actors.map(v=>copy(v)!),action:copy(e.action),object:copy(e.object),location:copy(e.location),eventTime:null,summary:null,facts:e.statements.map((s,i)=>({id:s.id,key:s.evidence.excerpt.normalize('NFKC').toLowerCase().trim(),arabic:s.evidence.excerpt,evidence:{...s.evidence},speaker:copy(s.speaker),kind:c.factLabels[i].kind,material:c.factLabels[i].material,verified:false}))}},source);
}

export function directSourceGrounded(u:Understanding,source:string){
 try{validateUnderstanding(u,source);return u.event.facts.length>0&&[...u.event.actors,u.event.action,u.event.object,u.event.location,...u.event.facts,...u.event.facts.map(f=>f.speaker)].filter(v=>v!==null).every(v=>v.arabic===v.evidence.excerpt);}catch{return false;}
}
export function usableArticle(raw:unknown){
 const p=directArticleSchema.safeParse(raw);
 if(!p.success)throw new ProcessingError('DIRECT_INVALID_ARTICLE_SCHEMA');
 const article=p.data;
 article.title=normalizeGeneratedArabic(article.title.trim());article.body=normalizeGeneratedArabic(article.body.trim());
 if(!article.title||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(article.title+article.body))throw new ProcessingError('DIRECT_CORRUPT_ARTICLE');

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
 // Semantic diagnostics never attest correctness. Objective defects fail closed
 // without adding an independent DIRECT review or relevance request.
 validateObjectiveArticle(source,article.title,article.body);
 u.directGeneration={version:'direct-generation-v2',sourceHash:hash(source),articleHash:hash(article),eventHash:eventHash(u),editorialContractHash:EDITORIAL_CONTRACT_SHA256,article,localDiagnostics,semanticVerification:'DIAGNOSTIC_ONLY'};
 return directFinalArticle(source,u);
}
export function directFinalArticle(source:string,u:Understanding){
 const parsed=directGenerationSchema.safeParse(u.directGeneration);
 if(!parsed.success)throw new ProcessingError('DIRECT_GENERATION_RECEIPT_REQUIRED');
 const r=parsed.data;
 const digest=r.version==='direct-generation-v3'?structuralHash:hash;
 if(r.version==='direct-generation-v3'){
  assertIndependentDirectReview(r.review,r.article);
  if(r.reviewHash!==digest(r.review)||r.matchingReviewHash!==digest(r.matchingReview))throw new ProcessingError('DIRECT_GENERATION_RECEIPT_CHANGED');
 }
 if(r.sourceHash!==digest(source)||r.articleHash!==digest(r.article)||r.eventHash!==eventHash(u,digest)||r.editorialContractHash!==EDITORIAL_CONTRACT_SHA256||!directSourceGrounded(u,source))throw new ProcessingError('DIRECT_GENERATION_RECEIPT_CHANGED');
 const article=usableArticle(r.article);
 if(r.version==='direct-generation-v3'&&r.propositionReview)validatePropositionBinding(r.propositionReview,source,[{id:'title',text:article.title},...(article.body?[{id:'body:1',text:article.body}]:[])]);
 if(!structurallyEqual(article,r.article))throw new ProcessingError('DIRECT_GENERATION_RECEIPT_CHANGED');
 if(r.version==='direct-generation-v3'&&r.review.fidelityLedger)validateFidelityLedger(source,[{id:'title',text:article.title},...(article.body?[{id:'body:1',text:article.body}]:[])],r.review.fidelityLedger);
 validateObjectiveArticle(source,article.title,article.body,r.version==='direct-generation-v3'?r.review.fidelityLedger:undefined);
 const factIds=u.event.facts.map(f=>f.id);
 return {generationReceipt:r,title:article.title,body:article.body,format:article.body?'STANDARD_STORY' as const:'FLASH' as const,hashtags:[],protectedQuotes:literalQuotes(source),protectedSpans:[],applied:[],review:[...new Set([...article.diagnostics,...r.localDiagnostics])].map(d=>reason('FORMAT_REVIEW',d)),sentences:[{text:article.title,factIds},...(article.body?[{text:article.body,factIds}]:[])],sentenceEvidence:[{text:article.title,factIds},...(article.body?[{text:article.body,factIds}]:[])],provenanceKind:'SOURCE_LINK_NOT_SEMANTIC_ATTESTATION' as const};
}

export function assertIndependentDirectReview(raw:unknown,article:{body:string}){
 const review=validatePublicationReviewProtocol(raw,article.body?1:0);
 if(!review.fullSourceCovered||!review.publicationQuality||!review.issues.every(isSoftReviewIssue)||review.review.some(r=>!factualReviewPassed(r)))throw new ProcessingError('DIRECT_PUBLICATION_UNSUPPORTED',false,{stage:'direct_independent_review',issues:[{code:'INDEPENDENT_FIDELITY_OR_CANONICAL_REVIEW_FAILED',path:['review']}],output:raw});
 return review;
}
/** Only a separate model response may supply this review; generation cannot
 * self-attest. The exact normalized text reviewed is frozen into the receipt. */
export function completeReviewedDirectGeneration(raw:unknown,source:string,u:Understanding,reviewRaw:unknown,matchingRaw:unknown=[]){
 const article=usableArticle(raw),review=assertIndependentDirectReview(reviewRaw,article);
 if(review.fidelityLedger)validateFidelityLedger(source,[{id:"title",text:article.title},...(article.body?[{id:"body:1",text:article.body}]:[])],review.fidelityLedger);
 const matchingReview=directMatchingReviewSchema.parse(matchingRaw);
 validateObjectiveArticle(source,article.title,article.body,review.fidelityLedger);
 u.directGeneration={version:'direct-generation-v3',...(u.propositionReview?{propositionReview:u.propositionReview}:{}),sourceHash:structuralHash(source),articleHash:structuralHash(article),eventHash:eventHash(u,structuralHash),editorialContractHash:EDITORIAL_CONTRACT_SHA256,article,localDiagnostics:[],semanticVerification:'INDEPENDENT',review,reviewHash:structuralHash(review),matchingReview,matchingReviewHash:structuralHash(matchingReview)};
 return directFinalArticle(source,u);
}
export function directComparisonKey(incoming:Understanding['event'],existing:Understanding['event']){
 const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='sourcePostId').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):v;
 return hash(stable({incoming,existing}));
}
export function reviewedDirectComparison(source:string,u:Understanding,existing:Understanding['event']){
 directFinalArticle(source,u);
 const r=u.directGeneration;
 if(r?.version!=='direct-generation-v3')throw new ProcessingError('DIRECT_MATCH_REVIEW_REQUIRED');
 const result=r.matchingReview.find(c=>c.id===directComparisonKey(u.event,existing));
 if(!result)throw new ProcessingError('DIRECT_MATCH_REVIEW_REQUIRED');
 return result.decision;
}
