import test from 'node:test';import assert from 'node:assert/strict';import {z} from 'zod';import {evidenceMetadataPlan,graftEvidenceMetadata,correctEvidenceMetadata} from '../src/lib/processing/evidence-metadata-correction';import {resolveContextEvidence} from '../src/lib/processing/groq-validation';import {ProcessingError} from '../src/lib/processing/contracts';
const evidence=z.object({excerpt:z.string(),context:z.string(),startOffset:z.number().nullable().optional(),endOffset:z.number().nullable().optional()}).strict();const schema=z.object({location:evidence,article:z.string()}).strict();
const source='أقر البرلمان الإيراني قانوناً جديداً لتنظيم النقل العام في إيران.';const raw={location:{excerpt:'إيران',context:source,startOffset:58,endOffset:63},article:'UNCHANGED'};const plan=()=>evidenceMetadataPlan(source,raw,schema);const answer=(p=plan())=>({corrections:p.slots.map(s=>({fieldId:s.fieldId,status:'RESOLVED',startOffset:59,endOffset:64}))});
const validate=(v:unknown)=>{const x=schema.parse(v);resolveContextEvidence(x.location,source);return x;};
test('captured exact correction full validator runs again and article frozen',async()=>{let n=0;const result=await correctEvidenceMetadata(source,raw,schema,v=>{n++;return validate(v);},async p=>answer(p));assert.equal(n,2);assert.equal(result.article,raw.article);assert.equal((result.location as unknown as {start:number}).start,59);assert.equal(raw.location.startOffset,58);});
test('both raw occurrences exposed with no ranking',()=>assert.deepEqual(plan().slots[0].candidates,[{startOffset:15,endOffset:20},{startOffset:59,endOffset:64}]));
for(const key of ['excerpt','context','fact','article'])test('reject unauthorized response '+key,()=>{const r=answer();Object.assign(r.corrections[0],{[key]:'changed'});assert.throws(()=>graftEvidenceMetadata(plan(),r));});
for(const kind of ['unknown','duplicate','missing'])test('reject correction IDs '+kind,()=>{const r=answer();if(kind==='unknown')r.corrections[0].fieldId='bad';if(kind==='duplicate')r.corrections.push(r.corrections[0]);if(kind==='missing')r.corrections=[];assert.throws(()=>graftEvidenceMetadata(plan(),r));});
test('wrong offset rejected',()=>{const r=answer();r.corrections[0].startOffset=58;assert.throws(()=>graftEvidenceMetadata(plan(),r),/RANGE/);});
test('UNRESOLVED blocks',()=>{const r=answer();r.corrections[0].status='UNRESOLVED';assert.throws(()=>graftEvidenceMetadata(plan(),r),/UNRESOLVED/);});
test('numeric ambiguity has no deterministic selection',async()=>{const s='3 طائرات و3 سفن',r={location:{excerpt:'3',context:s},article:'same'};let calls=0;await assert.rejects(correctEvidenceMetadata(s,r,schema,v=>{const x=schema.parse(v);resolveContextEvidence(x.location,s);return x;},async p=>{calls++;assert.equal(p.slots[0].candidates.length,2);return {corrections:p.slots.map(x=>({fieldId:x.fieldId,status:'UNRESOLVED',startOffset:null,endOffset:null}))};}),/UNRESOLVED/);assert.equal(calls,1);});
test('absent evidence ineligible',()=>assert.throws(()=>evidenceMetadataPlan(source,{...raw,location:{excerpt:'absent',context:source}},schema),/INVALID_EVIDENCE/));
test('known semantic veto prevents plan',()=>assert.throws(()=>evidenceMetadataPlan(source,raw,schema,true),/INELIGIBLE/));
test('valid evidence no request',async()=>{let calls=0;await correctEvidenceMetadata(source,{...raw,location:{...raw.location,startOffset:59,endOffset:64}},schema,validate,async()=>{calls++;});assert.equal(calls,0);});
test('post correction semantic rejection is not retried',async()=>{let calls=0;await assert.rejects(correctEvidenceMetadata(source,raw,schema,v=>{validate(v);throw new ProcessingError('WRONG_SEMANTIC_ASSOCIATION');},async p=>{calls++;const r=answer(p);r.corrections[0].startOffset=15;r.corrections[0].endOffset=20;return r;}),/WRONG_SEMANTIC_ASSOCIATION/);assert.equal(calls,1);});
test('new failure after correction no recursive call',async()=>{let n=0,calls=0;await assert.rejects(correctEvidenceMetadata(source,raw,schema,v=>{if(n++)throw new ProcessingError('AMBIGUOUS_EVIDENCE_CONTEXT');return validate(v);},async p=>{calls++;return answer(p);}),/AMBIGUOUS/);assert.equal(calls,1);});
test('all broken fields grouped',()=>{const s=z.object({a:evidence,b:evidence});const p=evidenceMetadataPlan(source,{a:raw.location,b:raw.location},s);assert.equal(p.slots.length,2);assert.notEqual(p.slots[0].fieldId,p.slots[1].fieldId);});
test('missing context not eligible',()=>assert.throws(()=>evidenceMetadataPlan(source,{...raw,location:{...raw.location,context:'wrong'}},schema),/INELIGIBLE/));

import {AssumedPropositionGemini as GeminiLanguageProvider} from './fixtures/proposition-mock';
import {unknownProfile} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {combinedFixture,reviewedFixture} from './fixtures/current-direct';
import {geminiEnvelope} from './fixtures/direct-bilingual';
import {checkpointCall,type CheckpointStore} from '../src/worker/checkpoints';
for(const reject of [false,true])test('DIRECT adapter correction then independent review '+reject,async()=>{
 const combined=combinedFixture(source);Object.assign(combined.extraction,{location:raw.location});let corrections=0,reviews=0;
 const provider=new GeminiLanguageProvider('offline',async(_url,init)=>{const body=JSON.parse(String(init?.body)),data=JSON.parse(body.contents[0].parts[0].text),props=body.generationConfig.responseJsonSchema.properties;
 if(props.extraction)return Response.json(geminiEnvelope(combined));
 if(props.corrections){corrections++;assert.deepEqual(data.extraction.article,combined.article);return Response.json(geminiEnvelope({corrections:data.slots.map((s:{fieldId:string})=>({fieldId:s.fieldId,status:'RESOLVED',startOffset:59,endOffset:64}))}));}
 reviews++;const review=reviewedFixture(source,data.publication);if(reject)for(const claim of review.fidelityLedger.claims){claim.verdict='UNSUPPORTED' as 'SUPPORTED';claim.explanation='Wrong fact association: explicit negative fixture.';}return Response.json(geminiEnvelope(review));});
 const operation=provider.understand({processingMode:'DIRECT',content:source,publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal);
 if(reject)await assert.rejects(operation);else{const u=await operation;assert.equal(u.event.location?.evidence.start,59);}
 assert.equal(corrections,1);assert(reviews>=1);
});
test('durable correction checkpoint reused and ambiguity not replayed',async()=>{
 let state:{output:unknown}|{pending:true}|null=null,calls=0;const store:CheckpointStore={load:async()=>state,start:async()=>{state={pending:true};},finish:async(_k,output)=>{state={output};},fail:async()=>{}};
 const key=plan().identity;await checkpointCall(store,key,async()=>{calls++;return answer();});await checkpointCall(store,key,async()=>{calls++;});assert.equal(calls,1);
 state=null;await assert.rejects(checkpointCall(store,key,async()=>{calls++;throw new ProcessingError('GEMINI_TRANSPORT_FAILED');}));await assert.rejects(checkpointCall(store,key,async()=>{calls++;}),/OUTCOME_REQUIRES_REVIEW/);assert.equal(calls,2);
});

test('JSONB property ordering preserves correction identity and request',()=>{const other={article:raw.article,location:{endOffset:63,startOffset:58,context:source,excerpt:'إيران'}};assert.deepEqual(evidenceMetadataPlan(source,other,schema),plan());});

for(const budget of [false,true])test('metadata obeys request budget and leaves article counters unchanged '+budget,async()=>{
 let calls=0;const p=new GeminiLanguageProvider('offline',async()=>{calls++;return Response.json(geminiEnvelope(answer()));});
 const delegate=(p as unknown as {delegate:{requests:number;repairedStages:Map<string,number>;metadataRequest:(plan:ReturnType<typeof evidenceMetadataPlan>,rules:typeof ruleSet,signal:AbortSignal)=>Promise<unknown>}}).delegate;
 if(budget)delegate.requests=8;
 const action=()=>delegate.metadataRequest(plan(),ruleSet,new AbortController().signal);
 if(budget)await assert.rejects(action(),/APPLICATION_CONTINUATION_BUDGET/);else{await action();await action();}
 assert.equal(calls,budget?0:1);assert.equal(delegate.repairedStages.size,0);
});

import {readFileSync} from 'node:fs';
import {minimalExtractionSchema,validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
const historical=JSON.parse(readFileSync('tests/fixtures/source-integrity-production.json','utf8')) as Array<{id:string;source:string;outputs:Array<{output:Record<string,unknown>}>}>;
for(const id of ['19728','19731'])test('stored '+id+' correction eligibility',async()=>{const row=historical.find(r=>r.id===id)!;const r=Object.fromEntries(Object.keys(minimalExtractionSchema.shape).map(k=>[k,row.outputs[0].output[k]]));let calls=0;const operation=correctEvidenceMetadata(row.source,r,minimalExtractionSchema,v=>validateMinimalExtraction(v,row.source),async p=>{calls++;return {corrections:p.slots.map(s=>({fieldId:s.fieldId,status:'UNRESOLVED',startOffset:null,endOffset:null}))};});if(id==='19728'){await assert.rejects(operation);assert.equal(calls,1);}else{await operation;assert.equal(calls,0);}});
test('stored 44228 unresolved metadata remains blocked',async()=>{const rows=JSON.parse(readFileSync('tests/fixtures/semantic-integrity-production-ten.json','utf8')) as Array<{case:number;sourceText:string;outputs:Record<string,unknown>[]}>;const row=rows.find(r=>r.case===5)!;const raw=Object.fromEntries(Object.keys(minimalExtractionSchema.shape).map(k=>[k,row.outputs[0][k]]));await assert.rejects(correctEvidenceMetadata(row.sourceText,raw,minimalExtractionSchema,v=>validateMinimalExtraction(v,row.sourceText),async p=>({corrections:p.slots.map(s=>({fieldId:s.fieldId,status:'UNRESOLVED',startOffset:null,endOffset:null}))})),/UNRESOLVED/);});
