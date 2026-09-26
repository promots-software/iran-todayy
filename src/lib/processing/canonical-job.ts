import {EDITORIAL_CONTRACT_SHA256} from './editorial-contract';
import {Prisma,type PrismaClient} from '@prisma/client';
import {runCanonicalFlow,assertCanonicalApproval,canonicalDigest,failedSections} from './canonical-flow';
import {matchCanonicalArticle} from './canonical-matching';
import {ProcessingError,type LanguageProvider,type Understanding,type EventData} from './contracts';
import {processingSource} from './processing-source';
import {sourceInputLanguage} from './source-language';
import {ruleSet} from './rules';
import type {Candidate} from './matcher';
import type {ClaimedJob} from './engine';
const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
const snapshot=async(db:Pick<Prisma.TransactionClient,'canonicalEvent'>)=>{
 const rows=await db.canonicalEvent.findMany({select:{id:true,createdAt:true,revisions:{orderBy:{revision:'desc'},take:1,select:{id:true,revision:true,facts:true,newsItem:{select:{publication:{select:{status:true}}}},matches:{select:{sourcePost:{select:{sourcePublishedAt:true}}}}}}}});
 const {eventSchema}=await import('./contracts');const candidates:Candidate[]=[];let legacy=0;
 for(const row of rows){const r=row.revisions[0],facts=eventSchema.safeParse(r?.facts);if(!r||!facts.success){legacy++;continue;}candidates.push({id:row.id,revisionId:r.id,revision:r.revision,data:facts.data,publishedAt:r.matches[0]?.sourcePost.sourcePublishedAt??row.createdAt,published:r.newsItem?.publication?.status==='SENT'});}
 candidates.sort((a,b)=>a.id.localeCompare(b.id));return {candidates,legacy,key:canonicalDigest({candidates,legacy})};
};
/** Staging-only adapter: whole-source provenance is application-owned. It is
 * not a claim of independently verified truth or a fabricated excerpt. */
export async function runCanonicalJob(db:PrismaClient,job:ClaimedJob,provider:LanguageProvider,signal:AbortSignal,mode:'NORMAL'|'DIRECT'){
 if(process.env.IRAN_TODAY_ENVIRONMENT!=='staging'||!provider.canonicalRequest)throw new ProcessingError('STAGING_CANONICAL_FLOW_REQUIRED');
 const post=job.sourcePost,source=processingSource(post),request=(r:Parameters<NonNullable<LanguageProvider['canonicalRequest']>>[0])=>provider.canonicalRequest!(r,signal);
 const canonical=await runCanonicalFlow(source,request,async cycle=>{await db.auditLog.create({data:{action:'CANONICAL_SECTION_CHECK',actor:'staging-worker',entityType:'SourcePost',entityId:post.id,message:'Complete canonical editorial check',metadata:json({cycle:cycle.cycle,contractHash:EDITORIAL_CONTRACT_SHA256,articleHash:canonicalDigest(cycle.article),check:cycle.check})}});});
 try {
 const article=canonical.cycles.at(-1)?.article;
 if(canonical.status==='APPROVED')assertCanonicalApproval(canonical,source,article!);
 const before=canonical.status==='APPROVED'?await snapshot(db):null;
 const match=before?await matchCanonicalArticle(source,post.sourcePublishedAt,before.candidates,request):null;
 if(match&&before?.legacy&&match.classification==='NEW_EVENT'){match.classification='UNCERTAIN_MATCH';match.rationale='Legacy event data cannot be safely compared';}
 signal.throwIfAborted();
 return await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20916001)`;
  await tx.$queryRaw`SELECT id FROM "ProcessingJob" WHERE id=${job.id} FOR UPDATE`;
  const live=await tx.processingJob.findUniqueOrThrow({where:{id:job.id}});
  if(live.status!=='RUNNING'||live.lockedBy!==job.lockedBy||!live.lockedAt||live.lockedAt.getTime()+300000<=Date.now())throw new ProcessingError('STALE_CLAIM',true);
  await tx.$queryRaw`SELECT id FROM "Source" WHERE id=${post.sourceId} FOR SHARE`;
  const current=await tx.source.findUniqueOrThrow({where:{id:post.sourceId}});
  if(!current.enabled||current.deletedAt)throw new ProcessingError('SOURCE_DISABLED');
  if(current.processingMode!==mode)throw new ProcessingError('SOURCE_PROCESSING_MODE_CHANGED',true,undefined,1000);
  if(before&&(await snapshot(tx)).key!==before.key)throw new ProcessingError('MATCH_SNAPSHOT_CHANGED',true,undefined,1000);
  const rules=await tx.editorialRuleSet.upsert({where:{version:ruleSet.version},update:{},create:{version:ruleSet.version,rules:json(ruleSet),provenance:json(ruleSet.provenance)}});
  const filtered=canonical.status==='FILTERED',failed=canonical.status==='NEEDS_REVIEW',uncertain=match?.classification==='UNCERTAIN_MATCH',duplicate=match?.classification==='DUPLICATE';
  const status=filtered?'FILTERED':failed||uncertain?'NEEDS_REVIEW':duplicate?'DUPLICATE':'PENDING_APPROVAL';
  const review=failed?failedSections(canonical.cycles.at(-1)!.check).flatMap(s=>s.defects.map(d=>({code:'CANONICAL_SECTION_FAILED',detail:`Section ${s.section}: ${d.defect}`,explanation:d.correction}))):uncertain?[{code:'UNCERTAIN_MATCH',detail:match!.rationale,explanation:match!.rationale}]:[];
  const event:EventData={actors:[],action:null,object:null,location:null,eventTime:null,summary:article?.title??null,facts:article?[{id:`source:${post.id}`,key:canonicalDigest(source),arabic:[article.title,article.body].filter(Boolean).join('\n'),evidence:{excerpt:source,start:0,end:source.length,sourcePostId:post.id},kind:'STATEMENT',material:true,speaker:null,verified:false}]:[]};
  const extraction:Understanding={language:sourceInputLanguage(source),relevance:filtered?'IRRELEVANT':'POLITICAL_NEWS',filterReason:filtered?'UNRELATED_TO_IRAN':'NONE',topic:'UNKNOWN',priority:'P3',rationale:'Canonical editorial contract',event,names:[],sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,uncoveredTerms:[]};
  const decision={editorialEligibility:filtered||duplicate?'FILTERED':failed?'NEEDS_REVIEW':uncertain?'MATCHING_HOLD':'READY_TO_PUBLISH',deliveryDecision:'HOLD'};
  const sentenceEvidence=article?[article.title,...article.body?[article.body]:[]].map(text=>({text,factIds:event.facts.map(f=>f.id)})):[];
  const draft=article?{...article,format:match?.classification==='MATERIAL_UPDATE'?'UPDATE':article.body?'NEWS':'FLASH',review,applied:[],protectedQuotes:[],sentenceEvidence}:null;
  let revisionId=match?.candidate?.revisionId,newsItemId:string|undefined;
  if(canonical.status==='APPROVED'&&!uncertain&&!duplicate){
   if(match?.classification==='MATERIAL_UPDATE'&&match.candidate){
    const previous=match.candidate;const merged={...event,facts:[...previous.data.facts.filter(f=>!event.facts.some(n=>n.id===f.id)),...event.facts]};
    revisionId=(await tx.eventRevision.create({data:{eventId:previous.id,revision:previous.revision+1,facts:json(merged),materialChange:article!.body||article!.title}})).id;
   }else{const created=await tx.canonicalEvent.create({data:{title:article!.title,summary:article!.title,facts:json(event),entities:[],extractionVersion:'canonical-forty-v1',revisions:{create:{revision:1,facts:json(event)}}},include:{revisions:true}});revisionId=created.revisions[0].id;}
   const validation={processingMode:mode,acceptance:{version:'iran-acceptance-v1',mode,accepted:true},...decision,canonicalApproval:canonical,validated:true,review,format:draft!.format,sentenceEvidence,applied:[]};
   newsItemId=(await tx.newsItem.create({data:{eventRevisionId:revisionId!,title:article!.title,arabicContent:article!.body,status:'PENDING_APPROVAL',validationStatus:'PASSED',protectedQuotes:[],factualEvidence:json(event.facts),validationResult:json(validation),needsReviewReasons:[],ruleSetId:rules.id,modeAtProcessing:post.modeAtProcessing,processingStartedAt:post.processingStartedAt??new Date()}})).id;
  }else if(duplicate&&revisionId)newsItemId=(await tx.newsItem.findUnique({where:{eventRevisionId:revisionId}}))?.id;
  if(newsItemId)await tx.newsEvidence.upsert({where:{newsItemId_sourcePostId:{newsItemId,sourcePostId:post.id}},create:{newsItemId,sourcePostId:post.id},update:{}});
  const links=uncertain?match!.candidates.map(c=>c.revisionId):revisionId?[revisionId]:[];
  for(const id of links)await tx.eventMatch.upsert({where:{sourcePostId_eventRevisionId:{sourcePostId:post.id,eventRevisionId:id}},update:{},create:{sourcePostId:post.id,eventRevisionId:id,classification:match!.classification,rationale:match!.rationale,evidence:json(match!.evidence),matcherVersion:'canonical-source-v1'}});
  await tx.sourcePost.update({where:{id:post.id},data:{status,error:null,nextRetryAt:null,rejectionReason:filtered?'UNRELATED_TO_IRAN':null,originalLanguage:extraction.language,relevance:extraction.relevance,relevanceResult:json({processingMode:mode}),processingResult:json({processingMode:mode,...decision,validated:canonical.status==='APPROVED',canonicalApproval:canonical,editorialStatus:canonical.status,classification:match?.classification??null,eventRevisionId:revisionId??null,extraction,draft,review,provider:'canonical-forty-v1',acceptance:{version:'iran-acceptance-v1',mode,accepted:!filtered}})}});
  await tx.processingJob.update({where:{id:job.id},data:{status:'COMPLETED',lockedAt:null,lockedBy:null,lastError:null}});
  await tx.auditLog.create({data:{action:'CANONICAL_PROCESSING_DECISION',actor:'staging-worker',entityType:'SourcePost',entityId:post.id,message:'Canonical editorial decision followed by operational matching',metadata:json({status,editorialStatus:canonical.status,cycles:canonical.cycles.length,classification:match?.classification??null,newsItemId:newsItemId??null,failedSections:failed?failedSections(canonical.cycles.at(-1)!.check):[]})}});
  return {postId:post.id,filtered};
 },{timeout:30000,maxWait:5000});
 }catch(error){
  if(canonical.status!=='APPROVED')throw error;
  const original=error instanceof ProcessingError?error:new ProcessingError('CANONICAL_MATCHING_FAILED');
  throw new ProcessingError(original.code,original.retryable,{stage:'canonical_matching',issues:[{code:original.code,path:[]}],output:{canonicalApproval:canonical,editorialStatus:'APPROVED'}},original.retryAfterMs);
 }
}
