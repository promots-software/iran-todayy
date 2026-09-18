/** Offline JSON snapshot replay. No DB, provider, ingestion or publisher imports. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {finalizeSelection} from '../src/lib/processing/local-finalization';
import {sourceProfileSchema,unknownProfile,understandingSchema} from '../src/lib/processing/contracts';
import {editorialDecision,type EditorialEligibility} from '../src/lib/processing/editorial-eligibility';
const path=process.argv[2],out=process.argv[3];
if(!path||!out)throw Error('Usage: tsx scripts/replay-editorial.ts input-snapshot.json output-report.json');
if(path===out)throw Error('Replay output must not overwrite input');
const original=readFileSync(path),snapshot=JSON.parse(original.toString());
const held={autoPublish:false,shadowMode:true,requireApproval:true};
const rows=(snapshot.jobs as {sourcePost:Record<string,unknown>}[]).map(job=>{
 // Snapshot contains only the read-only production export shape; the source
 // extraction itself is always parsed through the strict public contract.
 const p=job.sourcePost as {id:string;source?:{handle?:string;editorialProfile?:unknown};processingResult?:{extraction?:unknown;draft?:unknown;review?:{code:string;detail?:string}[]};status:string;error?:string;originalContent:string;originalLanguage?:string};
 const result=p.processingResult??{},u=understandingSchema.safeParse(result.extraction);
 const oldReview=Array.isArray(result.review)?result.review:[];
 const before=editorialDecision({error:p.error,filtered:p.status==='FILTERED',validated:p.status==='PENDING_APPROVAL',review:oldReview},held).editorialEligibility;
 let after:EditorialEligibility=before,replayed=false,reasons:string[]=oldReview.map((r:{code:string;detail?:string})=>r.detail&&/^[A-Z_]+$/.test(r.detail)?r.detail:r.code),format:string|null=null;
 if(!p.error&&result.draft&&u.success){
  const profile=sourceProfileSchema.safeParse(p.source?.editorialProfile);
  try{
   const ids=u.data.event.facts.map(f=>f.id);
   const draft=finalizeSelection({titleAtomId:ids[0],bodyAtomIds:ids},p.originalContent,u.data,profile.success?profile.data:unknownProfile);
   // Retain downstream dedup/conflict failures; replay never reruns paid matching.
   const retained=oldReview.filter((r:{code:string})=>['UNCERTAIN_MATCH','FIGURE_CONFLICT'].includes(r.code));
   const review=[...draft.review,...retained];
   after=editorialDecision({validated:true,review},held).editorialEligibility;
   reasons=review.map(r=>r.code);format=draft.format;replayed=true;
  }catch(e){reasons=[e instanceof Error?e.message:'LOCAL_REPLAY_FAILED'];after='NEEDS_REVIEW';}
 }
 return {id:p.id,source:p.source?.handle??'unknown',language:p.originalLanguage??'unknown',before,after,replayed,format,reasons:[...new Set(reasons)]};
});
const counts=(field:'before'|'after')=>Object.fromEntries(['READY_TO_PUBLISH','NEEDS_REVIEW','FILTERED','PROCESSING_ERROR'].map(k=>[k,{count:rows.filter(r=>r[field]===k).length,percent:rows.filter(r=>r[field]===k).length/rows.length*100}]));
const breakdown=(field:'source'|'language'|'format')=>Object.fromEntries([...new Set(rows.map(r=>String(r[field])))].map(k=>[k,{total:rows.filter(r=>String(r[field])===k).length,ready:rows.filter(r=>String(r[field])===k&&r.after==='READY_TO_PUBLISH').length}]));
const report={snapshotHash:createHash('sha256').update(original).digest('hex'),sample:rows.length,replayed:rows.filter(r=>r.replayed).length,before:counts('before'),after:counts('after'),bySource:breakdown('source'),byLanguage:breakdown('language'),byFormat:breakdown('format'),reasons:Object.fromEntries([...new Set(rows.flatMap(r=>r.reasons))].map(k=>[k,rows.filter(r=>r.reasons.includes(k)).length])),rows,aiCalls:0,telegramSends:0,productionWrites:0};
writeFileSync(out,JSON.stringify(report,null,2));
if(!readFileSync(path).equals(original))throw Error('Snapshot changed');
console.log(JSON.stringify({...report,rows:undefined}));
