import {compactMatcherCandidate} from '../src/lib/processing/canonical-matcher-documents';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {retrieveCanonicalCandidates,retrievalNormalize,retrievalTokens,retrievalDocument,retrievalRescueReasons,type RetrievalCandidate} from '../src/lib/processing/canonical-retrieval';
import {matchCanonicalArticle} from '../src/lib/processing/canonical-matching';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/canonical-retrieval-v1/historical.json',import.meta.url),'utf8')) as {
 catalog:(Omit<RetrievalCandidate,'createdAt'|'publishedAt'>&{createdAt:string;publishedAt:string})[];
 cases:{key:string;post:string;source:string;draft:string;sourcePublishedAt:string;now:string;candidateRefs:number[];expectedBase:number[];expected:number[];oldExpected:number[];clean:boolean;gold:{index:number;classification:'A'|'B'|'C'}[]}[];
};
const historical=fixture.cases.map(c=>({c,input:{source:c.source,draft:c.draft,publishedAt:new Date(c.sourcePublishedAt),now:new Date(c.now),candidates:c.candidateRefs.map(i=>({...fixture.catalog[i],createdAt:new Date(fixture.catalog[i].createdAt),publishedAt:new Date(fixture.catalog[i].publishedAt)}))}}));
const replay=historical.map(({c,input})=>({c,input,result:retrieveCanonicalCandidates(input)}));
for(const {c,result} of replay)test(`V1 frozen selection ${c.post} ${c.key}`,()=>{
 assert.deepEqual(result.base,c.expectedBase);assert.deepEqual(result.selected,c.expected);
});
test('V1 locks gold recall and distribution without claiming old Phase2 parity',()=>{
 assert.equal(replay.length,255);let links=0,decisions=0;const counts={A:0,B:0,C:0};
 for(const {c,result:r} of replay){if(!c.gold.length)continue;let all=true;for(const g of c.gold){if(r.selected.includes(g.index)){links++;counts[g.classification]++;}else all=false;}if(all)decisions++;}
 assert.equal(links,38);assert.equal(decisions,35);assert.deepEqual(counts,{A:13,B:7,C:18});
 const n=replay.map(r=>r.result.selected.length).sort((a,b)=>a-b);
 assert.equal(n.reduce((s,v)=>s+v,0),1153);assert.equal(n[127],4);assert.equal(n[Math.ceil(n.length*.9)-1],7);assert.equal(n.at(-1),10);
 assert.equal(n.filter(x=>x===3).length,80);assert.equal(replay.filter(x=>x.result.selected.length>x.result.base.length).length,173);
 assert.equal(replay.filter(x=>JSON.stringify(x.result.selected)===JSON.stringify(x.c.oldExpected)).length,251);
 const clean=replay.filter(x=>x.c.clean);assert.equal(clean.length,50);assert.equal(clean.reduce((s,x)=>s+x.result.selected.length,0)/50,4.76);
});
test('retrieval normalization is separate from source bytes and explicit about Persian, numbers and ZWNJ',()=>{
 const raw='أَة ى ؤ ئ ی ک ۱۲٣ می‌رود @handle https://example.invalid/a';
 assert.equal(retrievalNormalize(raw),'اة ى ؤ ئ ي ك 123 مي‌رود    ');
 assert.deepEqual(retrievalTokens(raw,true),['اه','ي','و','ي','ي','ك','123','مي','رود']);
 assert.equal(raw,'أَة ى ؤ ئ ی ک ۱۲٣ می‌رود @handle https://example.invalid/a');
});
const now=new Date('2026-09-28T12:00:00Z');
function candidate(i:number,text:string):RetrievalCandidate{return {id:`e${String(i).padStart(3,'0')}`,revisionId:`r${i}`,revision:1,createdAt:new Date(now.getTime()-3600000),publishedAt:now,published:false,data:{actors:[],action:null,object:null,location:null,eventTime:null,summary:text,facts:[]}};}
test('document includes summary and every Arabic/evidence field; empty optional summary stays empty',()=>{
 const c=candidate(0,'عنوان');c.data.facts=[{id:'f',key:'k',arabic:'خبر',evidence:{excerpt:'المصدر',start:0,end:6},kind:'STATEMENT',material:true,speaker:null,verified:false}];
 assert.equal(retrievalDocument(c),'عنوان\nخبر\nالمصدر');c.data.summary=null;c.data.facts=[];assert.equal(retrievalDocument(c),'');
});
test('empty tokens/pool, stable ID sorting, score ties and no input mutation',()=>{
 const candidates=[candidate(3,''),candidate(1,''),candidate(2,''),candidate(0,'')];const before=structuredClone(candidates);
 const input={source:'',draft:'',publishedAt:now,now,candidates};const a=retrieveCanonicalCandidates(input),b=retrieveCanonicalCandidates({...input,candidates:[...candidates].reverse()});
 assert.deepEqual(a.candidates.map(c=>c.id),['e000','e001','e002']);assert.deepEqual(a,b);assert.deepEqual(a.scores,[0,0,0,0]);assert.deepEqual(candidates,before);
 assert.deepEqual(retrieveCanonicalCandidates({...input,candidates:[]}).selected,[]);
});
test('five-hour base boundaries use event availability, not publication time',()=>{
 const candidates=[candidate(0,''),candidate(1,''),candidate(2,''),candidate(3,'')];
 candidates[0].createdAt=new Date(now.getTime()-5*3600000);candidates[1].createdAt=new Date(now.getTime()-5*3600000-1);candidates[2].createdAt=new Date(now.getTime()+1);candidates[3].createdAt=now;
 const r=retrieveCanonicalCandidates({source:'',draft:'',publishedAt:now,now,candidates});assert.deepEqual(r.base,[0,3]);assert.deepEqual(r.selected,[0,3]);
});
test('all three rescue rules have exact inclusive boundaries and require rare agreement',()=>{
 assert.deepEqual(retrievalRescueReasons({bmRank:3,fpRank:5,timeRank:2,rareTerms:2,rarePhrases:0}),['RANK_AGREEMENT']);
 assert.deepEqual(retrievalRescueReasons({bmRank:10,fpRank:10,timeRank:2,rareTerms:2,rarePhrases:2}),['RARE_PHRASE_AND_RANK']);
 assert.deepEqual(retrievalRescueReasons({bmRank:20,fpRank:15,timeRank:1,rareTerms:2,rarePhrases:1}),['NEAREST_SOURCE_TIME_AND_RARE_PHRASE']);
 for(const s of [{bmRank:4,fpRank:5,timeRank:2,rareTerms:2,rarePhrases:0},{bmRank:10,fpRank:11,timeRank:2,rareTerms:2,rarePhrases:2},{bmRank:20,fpRank:15,timeRank:2,rareTerms:2,rarePhrases:1},{bmRank:1,fpRank:1,timeRank:1,rareTerms:1,rarePhrases:5}])assert.deepEqual(retrievalRescueReasons(s),[]);
});
test('older history rescue has no hard cap and compact transport sees only selected candidates',async()=>{
 const candidates=Array.from({length:20},(_,i)=>candidate(i,`term${i} actor${i} place${i}`));
 for(const c of candidates){c.createdAt=new Date(now.getTime()-8*3600000);c.publishedAt=new Date(now.getTime()-3600000);}
 candidates[19].publishedAt=now;
 const source=candidates.map(c=>c.data.summary).join('\n');const r=retrieveCanonicalCandidates({source,draft:'',publishedAt:now,now,candidates});
 assert.equal(r.base.length,0);assert.equal(r.candidates.length,11);assert.ok(r.selected.includes(19));
 let calls=0;const match=await matchCanonicalArticle(source,now,r.candidates,async request=>{calls++;const input=request.input as {snapshot:string;candidates:{id:string;event:unknown}[]};assert.equal(input.candidates.length,11);assert.deepEqual(input.candidates,r.candidates.map(compactMatcherCandidate));return {snapshot:input.snapshot,assessmentComplete:true,matches:[]};});assert.equal(match.classification,'NEW_EVENT');assert.equal(calls,1);
});
test('invalid dates and duplicate immutable identities fail closed',()=>{
 const input={source:'',draft:'',publishedAt:now,now,candidates:[candidate(0,'')]};
 assert.throws(()=>retrieveCanonicalCandidates({...input,now:new Date(NaN)}),/INVALID_RETRIEVAL_CATALOG/);
 assert.throws(()=>retrieveCanonicalCandidates({...input,candidates:[candidate(0,''),candidate(0,'')]}),/INVALID_RETRIEVAL_CATALOG/);
});
test('runtime retains full-pool fence, legacy hold, approval and persists retrieval metadata before matching',()=>{
 const code=readFileSync(new URL('../src/lib/processing/canonical-job.ts',import.meta.url),'utf8');
 assert.ok(code.includes("if(before&&(await snapshot(tx)).key!==before.key)"));assert.ok(code.includes("before?.legacy&&match.classification==='NEW_EVENT'"));assert.ok(code.includes('assertCanonicalApproval(canonical,source,article!)'));
 assert.ok(code.includes('retrieval.candidates,request,retrievalAudit!'));assert.ok(code.includes('retrieval:retrievalAudit'));assert.ok(code.indexOf("action:'CANONICAL_MATCH_RETRIEVAL'")<code.indexOf('await matchCanonicalArticle'));
});
test('retrieval identity binds compact snapshot and is preserved in match evidence',async()=>{
 const c=candidate(0,'إيران');const binding={version:'CANONICAL_RETRIEVAL_V1',poolDigest:'full-pool',queryDigest:'query',selectedRevisionIds:['r0']};let first='';
 const m=await matchCanonicalArticle('إيران',now,[c],async r=>{const i=r.input as {snapshot:string};first=i.snapshot;return {snapshot:first,assessmentComplete:true,matches:[['c0','S',false,false,'same']]};},binding);
 assert.equal(m.classification,'DUPLICATE');assert.deepEqual(m.evidence.retrieval,binding);
 await assert.rejects(matchCanonicalArticle('إيران',now,[c],async()=>({snapshot:first,assessmentComplete:true,matches:[]}),{...binding,poolDigest:'changed'}),/INVALID_COMPARISON_SCHEMA/);
});


test('BM25 k1=1.2 b=.75 and fingerprint IDF use full document population',()=>{
 const c=candidate(0,'alpha alpha beta');const r=retrieveCanonicalCandidates({source:'alpha',draft:'',publishedAt:now,now,candidates:[c]});
 assert.equal(r.scores[0],Math.log(1+.5/1.5)*2*2.2/(2+1.2));assert.equal(r.fingerprint[0],Math.log(1+1/2));
});

test('audit wall clock does not invalidate an otherwise identical matcher checkpoint binding',async()=>{
 const base={version:'CANONICAL_RETRIEVAL_V1',poolDigest:'pool',queryDigest:'query',selectedRevisionIds:['r0']};const snapshots:string[]=[];
 for(const retrievedAt of ['2026-09-28T10:00:00Z','2026-09-28T10:01:00Z']){
  await matchCanonicalArticle('إيران',now,[candidate(0,'إيران')],async r=>{const i=r.input as {snapshot:string};snapshots.push(i.snapshot);return {snapshot:i.snapshot,assessmentComplete:true,matches:[]};},{...base,retrievedAt} as typeof base);
 }
 assert.equal(snapshots[0],snapshots[1]);
});

test('actual staging job uses V1 before compact matching and keeps full-pool transaction fence (mock DB only)',async()=>{
 const {runCanonicalJob}=await import('../src/lib/processing/canonical-job');
 const {ProcessingError}=await import('../src/lib/processing/contracts');
 const audit:{action:string;metadata:Record<string,unknown>}[]=[];let snapshotReads=0,wireCount=0;const stages:string[]=[];
 const pool=Array.from({length:4},(_,i)=>{const c=candidate(i,'إيران');return {id:c.id,createdAt:new Date(),revisions:[{id:c.revisionId,revision:1,facts:c.data,newsItem:null,matches:[]}]};});
 const snapshotRows=(concurrent=false)=>{snapshotReads++;return [...pool.map(e=>({digest:e.id,payload:{id:e.id,createdAt:e.createdAt.toISOString(),revisionId:e.revisions[0].id,revision:1,facts:e.revisions[0].facts,publishedAt:e.createdAt.toISOString(),published:false}})),...(concurrent?[{digest:'concurrent',payload:{id:'concurrent',createdAt:new Date().toISOString(),revisionId:null,revision:null,facts:null,publishedAt:new Date().toISOString(),published:false}}]:[])];};
 const db={auditLog:{create:async({data}:{data:{action:string;metadata:Record<string,unknown>}})=>{audit.push(data);}},$queryRaw:async()=>snapshotRows(),$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({
  $queryRaw:async(q:{sql?:string})=>q.sql?.includes('WITH documents')?snapshotRows(true):[],processingJob:{findUniqueOrThrow:async()=>({status:'RUNNING',lockedBy:'offline',lockedAt:new Date()})},source:{findUniqueOrThrow:async()=>({enabled:true,deletedAt:null,processingMode:'DIRECT'})}
 })};
 const source='افتتحت إيران مكتبة عامة في طهران.';const job={id:'offline',lockedBy:'offline',sourcePost:{id:'offline-post',sourceId:'offline-source',sourcePublishedAt:new Date(),originalContent:source,normalizedContent:source}};
 const provider={canonicalRequest:async(r:{stage:string;input:unknown})=>{stages.push(r.stage);if(r.stage==='canonical_intake')return {newsValue:'KEEP',newsValueRationale:'Offline existing downstream routing fixture',iranRelated:true,rationale:'إيران'};if(r.stage==='canonical_generate')return {title:'إيران الآن | مكتبة عامة في طهران',body:source};if(r.stage==='canonical_check')return {sections:Object.fromEntries(Array.from({length:40},(_,i)=>[String(i+1),{status:'PASS',defects:[]}]))};assert.equal(r.stage,'canonical_match');const input=r.input as {snapshot:string;candidates:unknown[]};wireCount=input.candidates.length;return {snapshot:input.snapshot,assessmentComplete:true,matches:[]};}};
 const previous=process.env.IRAN_TODAY_ENVIRONMENT;process.env.IRAN_TODAY_ENVIRONMENT='staging';
 try{await assert.rejects(runCanonicalJob(db as unknown as Parameters<typeof runCanonicalJob>[0],job as unknown as Parameters<typeof runCanonicalJob>[1],provider as unknown as Parameters<typeof runCanonicalJob>[2],new AbortController().signal,'DIRECT'),(e:unknown)=>e instanceof ProcessingError&&e.code==='MATCH_SNAPSHOT_CHANGED');}
 finally{if(previous===undefined)delete process.env.IRAN_TODAY_ENVIRONMENT;else process.env.IRAN_TODAY_ENVIRONMENT=previous;}
 assert.equal(wireCount,3);assert.equal(snapshotReads,2);assert.deepEqual(stages,['canonical_intake','canonical_generate','canonical_check','canonical_match']);
 const metadata=audit.find(a=>a.action==='CANONICAL_MATCH_RETRIEVAL')!.metadata;assert.equal(metadata.version,'CANONICAL_RETRIEVAL_V1');assert.equal(metadata.poolCount,4);assert.equal((metadata.selectedRevisionIds as string[]).length,3);assert.ok(metadata.retrievedAt);
});
