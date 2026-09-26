import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {bookkeepingContract,indexedSpanCatalog,frozenArticleBinding} from '../src/lib/processing/bookkeeping-contract';
import {bookkeepingContract as legacy} from './fixtures/post-generation-binding/legacy-contract';
import {normalExtractionSchema,normalStage} from '../src/lib/processing/normal-v2';
import {directCombinedSchema} from '../src/lib/processing/direct-two-stage';
import {directPublicationReviewSchema} from '../src/lib/processing/direct-publication-contract';
import {fidelityLedgerSchemaFor} from '../src/lib/processing/fidelity-ledger';
import {parseProviderJson} from '../src/lib/processing/strict-json';
import {bindingFixture} from './fixtures/binding-wire';
import {combinedFixture} from './fixtures/current-direct';
import {ProcessingError} from '../src/lib/processing/contracts';
import {scopePreserved} from '../src/lib/processing/targeted-repair';
import frozen from './fixtures/post-generation-binding/frozen-21.json';
const text='أعلنت إيران افتتاح مدرسة.';
const article={title:text,body:'فقرة أولى.\n\nفقرة ثانية.',diagnostics:[]};
function example(source=text,extra:Record<string,unknown>={}){
 const c=bookkeepingContract('extract',{content:source,...extra},normalExtractionSchema)!;
 const {safety:ignored,...x}=combinedFixture(source).extraction;void ignored;
 const output=bindingFixture(c.input,{...x,statements:x.statements.map(({evidence,speaker})=>({evidence,speaker}))});
 return {c,output};
}
for(const namespace of ['source','candidate:title'])test(namespace+' integer endpoints resolve through exact immutable atom IDs',()=>{
 const c=indexedSpanCatalog(text,namespace),e=c.resolve({first:1,last:1});assert.equal(e.excerpt,'إيران');assert.equal(text.slice(e.startOffset,e.endOffset),'إيران');assert.equal(c.atoms[1].id.split(':').at(-1),'1');
});
for(const bad of [-1,999,1.5,'إيران','source:abc:1',null])test('invalid index rejected without coercion '+String(bad),()=>assert.throws(()=>indexedSpanCatalog(text,'source').resolve({first:bad,last:1} as never)));
test('request frozen against caller/catalog mutation',()=>{const input={content:text,publication:[]};const c=bookkeepingContract('extract',input,normalExtractionSchema)!;const v=example(text,{publication:[]}).output;input.content='نص مختلف';assert.doesNotThrow(()=>c.decode(v));const atoms=(c.input as {bookkeeping:{sourceAtoms:object[]}}).bookkeeping.sourceAtoms;assert(Object.isFrozen(atoms));assert.equal(Reflect.set(atoms[0],'text','wrong'),false);});
for(const change of [{repair:{cycle:1}},{repair:{cycle:2}},{content:text+' آخر'},{profile:{name:'different request'}}])test('different request identity rejects stale response '+JSON.stringify(change),()=>{const a=example(),b=example(text,change);assert.throws(()=>b.c.decode(a.output));});
test('correct R1 request binds, wrong R1 identity cannot be reused for R2',()=>{const a=example(text,{repair:{cycle:1,previousOutput:article}}),b=example(text,{repair:{cycle:2,previousOutput:article}});assert.doesNotThrow(()=>a.c.decode(a.output));assert.throws(()=>b.c.decode(a.output));});
test('same words preserve exact second occurrence',()=>{const c=indexedSpanCatalog('إيران ثم إيران','source'),r=c.resolve({first:2,last:2});assert.equal(r.startOffset,9);assert.equal(r.excerpt,'إيران');});
for(const source of ['إيران، إيران.','قائم‌پناه در ایران گفت.','🔺 إيران أعلنت.','ایران ۱۲۳ — إيران'])test('punctuation Unicode ZWNJ UTF16 '+source,()=>{const c=indexedSpanCatalog(source,'source');for(let i=0;i<c.atoms.length;i++){const r=c.resolve({first:i,last:i});assert.equal(r.excerpt,c.atoms[i].text);assert.equal(source.slice(r.startOffset,r.endOffset),c.atoms[i].text);}assert.doesNotThrow(()=>example(source).c.decode(example(source).output));});
test('frozen V0 newline equality is local, not echoed by provider',()=>{const input={originalSource:text,frozenArticle:article,validatedFacts:{facts:[{id:'f1'}]}};const c=frozenArticleBinding(input)!;const raw={catalogId:(c.input as {bookkeeping:{catalogId:string}}).bookkeeping.catalogId,links:{title:[0],body:[0]},coverage:{u1:{factIndices:[0],nonFactual:false}}};const decoded=c.decode(raw) as {publication:{body:{text:string}[]}};assert.equal(decoded.publication.body[0].text,article.body);assert(!Object.keys((c.schema as z.ZodObject<z.ZodRawShape>).shape).includes('publication'));assert.throws(()=>c.decode({...raw,publication:{body:article.body.replace(/\n/g,' ')}}));});
test('frozen binding does not infer missing links',()=>{const c=frozenArticleBinding({originalSource:text,frozenArticle:article,validatedFacts:{facts:[{id:'f1'}]}})!;assert.throws(()=>c.decode({catalogId:(c.input as {bookkeeping:{catalogId:string}}).bookkeeping.catalogId,links:{title:[0],body:[0]},coverage:{u1:{factIndices:[],nonFactual:false}}}),/INCOMPLETE_COVERAGE_SELECTION/);});
test('complete repeated heading explicitly references the same statement',()=>{const s=text+'\n\n'+text,x=example(s);x.output.unitCoverage={u1:{statementIndices:[0],nonFactual:false},u3:{statementIndices:[0],nonFactual:false}};const v=x.c.decode(x.output) as {coverage:{factIds:string[]}[]};assert.deepEqual(v.coverage.map(c=>c.factIds),[['f1'],['f1']]);});
for(const kind of ['missing row','empty support','unknown statement','duplicate','nonfactual conflict'])test('coverage fail closed '+kind,()=>{const x=example();if(kind==='missing row')delete x.output.unitCoverage.u1;if(kind==='empty support')x.output.unitCoverage.u1.statementIndices=[];if(kind==='unknown statement')x.output.unitCoverage.u1.statementIndices=[99];if(kind==='duplicate')x.output.unitCoverage.u1.statementIndices=[0,0];if(kind==='nonfactual conflict')x.output.unitCoverage.u1.nonFactual=true;assert.throws(()=>x.c.decode(x.output));});
for(const code of ['UNKNOWN_EVIDENCE_SELECTION','INCOMPLETE_COVERAGE_SELECTION','AI_INVALID_SCHEMA'])test('mechanical failure never authorizes article repair '+code,async()=>{let attempts=0,repairs=0;await assert.rejects(normalStage('draft',async()=>{attempts++;throw new ProcessingError(code);},text,undefined,()=>{repairs++;return true;}));assert.equal(attempts,1);assert.equal(repairs,0);});
test('binding success does not bypass repair scope',()=>{const x=example(text,{repair:{cycle:1}});assert.doesNotThrow(()=>x.c.decode(x.output));assert.equal(scopePreserved({article:{title:text,body:''}},{article:{title:text+' لتحقيق مكاسب',body:''}},[]),false);});
for(const p of frozen)test('frozen historical failure remains invalid: '+p.post,()=>{
 const last=p.responses.at(-1)!;const raw=last?parseProviderJson(last.raw):null;
 if(p.draftFailure){assert.throws(()=>z.object({publication:z.object({body:z.array(z.object({text:z.literal(p.draftFailure!.expected)})).length(1)})}).parse({publication:{body:[{text:p.draftFailure.actual}]}}));return;}
 const o=raw as Record<string,unknown>;let contract;
 if(o.fidelityLedger){const publication=(last as {publication?:{id:string;text:string}[]}).publication!;const ids=publication.map(p=>p.id);const canonical=z.object({fidelityLedger:fidelityLedgerSchemaFor(p.source,publication),...directPublicationReviewSchema.omit({fidelityLedger:true}).shape,review:z.array(directPublicationReviewSchema.shape.review.element.extend({id:z.enum(ids)})).length(ids.length)}).strict();contract=legacy('direct_publication_review',{originalSource:p.source,publication},canonical)!;
 }else{const step=o.extraction?'direct_combined':'extract';const canonical=step==='extract'?normalExtractionSchema:o.article?directCombinedSchema:directCombinedSchema.omit({article:true});contract=legacy(step,{content:p.source},canonical)!;}
 if(p.error==='AI_INVALID_SCHEMA')assert.throws(()=>contract.decode(raw));else assert.throws(()=>contract.decode(raw),new RegExp(p.error));
 // No prose -> integer conversion, no simulated new model result.
 const step=o.extraction?'direct_combined':'extract',c=bookkeepingContract(step,{content:p.source},step==='extract'?normalExtractionSchema:directCombinedSchema)!;assert.throws(()=>c.decode(raw));
});
test('all 21 saved terminal failures retained, no provider regeneration',()=>{assert.equal(frozen.length,21);assert.equal(frozen.filter(p=>p.error==='UNKNOWN_EVIDENCE_SELECTION').length,16);assert.equal(frozen.filter(p=>p.error==='INCOMPLETE_COVERAGE_SELECTION').length,3);assert.equal(frozen.filter(p=>p.error==='AI_INVALID_SCHEMA').length,2);});
test('catalog does not include machine-owned atom IDs or offsets on wire',()=>{const x=example();const b=(x.c.input as {bookkeeping:{sourceAtoms:object[]}}).bookkeeping;assert.deepEqual(Object.keys(b.sourceAtoms[0]),['index','text']);assert(!JSON.stringify(b).includes('source:'));});
test('post-V0 extraction does not repeat intake disposition',()=>{const x=example(text,{frozenArticle:article});const shape=(x.c.schema as z.ZodObject<z.ZodRawShape>).shape;assert(!('relevance'in shape));assert(!('contentType'in shape));const v=x.c.decode(x.output) as {relevance:string};assert.equal(v.relevance,'POLITICAL_NEWS');assert.throws(()=>x.c.decode({...x.output,relevance:'IRRELEVANT'}));});

import n5 from './fixtures/proposition-v44/N5.json';
import {reviewPropositions,enforcePropositionReview,propositionRepairDiagnostics} from '../src/lib/processing/proposition-review';
import {fixture} from './fixtures/processing';
import {reviewedFixture} from './fixtures/current-direct';
import {validateFidelityLedger} from '../src/lib/processing/fidelity-ledger';
test('binding does not endorse false nonfactual disposition',()=>{
 const publication=[{id:'title',text}],input={originalSource:text,publication};
 const c=bookkeepingContract('direct_publication_review',input,directPublicationReviewSchema)!;
 const r=reviewedFixture(text,publication);r.fidelityLedger.sourceCoverage[0].disposition='NON_MATERIAL_PRESENTATION';
 const {comparisons:ignored,...rest}=r;void ignored;
 const v=c.decode(bindingFixture(c.input,rest)) as {fidelityLedger:unknown};
 assert.throws(()=>validateFidelityLedger(text,publication,v.fidelityLedger));
});
test('successful integer binding reaches independent V4.4: unsupported purpose, temporal change and attribution all authorize only bounded repair',async()=>{
 const source=n5.source.units[0].text,candidate=n5.candidate.units[0].text;
 const x=example(source);assert.doesNotThrow(()=>x.c.decode(x.output));
 const remap=(v:unknown,unit:string):unknown=>Array.isArray(v)?v.map(x=>remap(x,unit)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,w])=>[k,k==='unitId'?unit:remap(w,unit)])):v;
 let calls=0;
 const result=await reviewPropositions(source,[{id:'title',text:candidate}],async q=>{calls++;return q.stage==='proposition_source'?remap(n5.source.inventory,'source'):q.stage==='proposition_candidate'?remap(n5.candidate.inventory,'title'):q.stage==='proposition_assessor'?remap(n5.assessor,'title'):remap(n5.comparator,'title');});
 assert.equal(calls,4);const u=fixture('negative',source,'ar',source).understanding,copy={article:{title:candidate,body:''}};
 const diagnoses=propositionRepairDiagnostics(result,source,u,copy,true);assert.equal(diagnoses.length,3);
 assert.deepEqual(new Set(diagnoses.map(d=>d.cause)),new Set(['STRUCTURED_ENTITY','STRUCTURED_TEMPORAL','STRUCTURED_MISSING_SUPPORT']));
 assert.throws(()=>enforcePropositionReview(result,source,u,copy,true),/DIRECT_PUBLICATION_UNSUPPORTED/);
 let runs=0;
 await assert.rejects(normalStage('direct_combined',async repair=>{runs++;if(repair){assert.equal(repair.cycle,1);assert.equal(repair.diagnostics?.length,3);throw new ProcessingError('OFFLINE_R1_BOUNDARY');}enforcePropositionReview(result,source,u,copy,true);},source),/OFFLINE_R1_BOUNDARY/);
 assert.equal(runs,2);
});

import {validateObjectiveArticle} from '../src/lib/processing/direct-publication';
import type {RepairDiagnostic} from '../src/lib/processing/targeted-repair';
test('119468 quote diagnosis reaches R1 request binding and scope validation; historical R1 remains uncertified',async()=>{
 const p=frozen.find(p=>p.post==='iraninarabic/119468')!;
 assert.throws(()=>validateObjectiveArticle(p.source,p.v0.title,p.v0.body),/DIRECT_PUBLICATION_QUOTE_MISMATCH/);
 const before={article:p.v0},path=['article','body'];
 const diagnostic:RepairDiagnostic={code:'DIRECT_PUBLICATION_QUOTE_MISMATCH',path,current:p.v0.body,expected:'No unsupported direct quotation',cause:'Unsupported quotation delimiter',sourceSpans:[{start:0,end:p.source.length,text:p.source}],factIds:['f1'],speakerIds:[],occurrenceIds:['0:'+p.source.length],allowedPaths:[path]};
 // Synthetic control, NOT a translated/repaired historical provider response.
 const revised={...p.v0,body:p.v0.body.replace(/[«»]/gu,'')};let calls=0;
 const result=await normalStage('direct_combined',async repair=>{
  calls++;if(!repair)throw new ProcessingError('DIRECT_PUBLICATION_QUOTE_MISMATCH',false,{stage:'direct_combined',issues:[{code:diagnostic.code,path}],output:before,repairDiagnostics:[diagnostic]});
  assert.equal(repair.cycle,1);
  const old=example(p.source,{frozenArticle:p.v0}),fresh=example(p.source,{frozenArticle:revised,repair});
  assert.throws(()=>fresh.c.decode(old.output));assert.doesNotThrow(()=>fresh.c.decode(fresh.output));
  assert(scopePreserved(before,{article:revised},[diagnostic]));
  assert(!scopePreserved(before,{article:{...revised,title:'unrelated change'}},[diagnostic]));
  return 'SCOPE_CHECK_REACHED_NOT_SEMANTIC_ACCEPTANCE';
 },p.source);
 assert.equal(calls,2);assert.equal(result,'SCOPE_CHECK_REACHED_NOT_SEMANTIC_ACCEPTANCE');
});
