import {GeminiLanguageProvider} from '../src/lib/processing/gemini';
import {unknownProfile,ProcessingError} from '../src/lib/processing/contracts';
import {ruleSet} from '../src/lib/processing/rules';
import {editorialContract} from '../src/lib/processing/editorial-contract';
import {validateObjectiveArticle} from '../src/lib/processing/direct-publication';
import test from 'node:test';
import assert from 'node:assert/strict';
import {bookkeepingContract,indexedSpanCatalog as spanCatalog} from '../src/lib/processing/bookkeeping-contract';
import {normalExtractionSchema,normalSelection,validateNormalExtractionCoverage} from '../src/lib/processing/normal-v2';
import {validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {directIndependentSchemaFor} from '../src/lib/processing/direct-two-stage';
import {validateFidelityReceipt,validateFidelityLedger} from '../src/lib/processing/fidelity-ledger';
import {evidenceMetadataPlan,evidenceMetadataWire,graftEvidenceMetadata} from '../src/lib/processing/evidence-metadata-correction';
import {parseProviderJson} from '../src/lib/processing/strict-json';
import {sourceUnits} from '../src/lib/processing/source-units';
import frozen from './fixtures/staging-hardening/frozen-13.json';
const source='أعلنت إيران افتتاح المدرسة اليوم.';
function select(text:string,namespace:string,excerpt=text,occurrence=0){
 const catalog=spanCatalog(text,namespace);let start=-1;for(let n=0;n<=occurrence;n++)start=text.indexOf(excerpt,start+1);
 assert(start>=0);const first=catalog.atoms.find(a=>a.start===start),last=catalog.atoms.find(a=>a.end===start+excerpt.length);assert(first&&last);return {first:catalog.atoms.indexOf(first),last:catalog.atoms.indexOf(last)};
}
function extraction(text=source){
 const contract=bookkeepingContract('extract',{content:text},normalExtractionSchema)!;
 const units=sourceUnits(text);const evidence={span:select(text,'source'),context:{firstUnit:units[0].id,lastUnit:units.at(-1)!.id}};
 const raw={catalogId:(contract.input as {bookkeeping:{catalogId:string}}).bookkeeping.catalogId,relevance:'POLITICAL_NEWS',contentType:'NEWS',contentTypeEvidence:evidence,actors:[],action:null,object:null,location:null,event_time:null,statements:[{evidence,speaker:null}],unitCoverage:Object.fromEntries(units.map(u=>[u.id,{statementIndices:[0],nonFactual:false}]))};
 return {contract,raw};
}
const state={time:'PAST',phase:'COMPLETED',continuity:'UNSPECIFIED',certainty:'ASSERTED'};
const checks={scope:true,entitiesAndRelationships:true,namesAndTitles:true,numbers:true,attribution:true,negationAndModality:true,literalQuotes:true};
function receipt(text=source,title=source){
 const publication=[{id:'title',text:title}];const input={originalSource:text,publication,comparisons:[]};
 const contract=bookkeepingContract('direct_independent_review',input,directIndependentSchemaFor(input))!;
 const raw={catalogId:(contract.input as {bookkeeping:{catalogId:string}}).bookkeeping.catalogId,review:{title:{verdict:'SUPPORTED',checks,issues:[]}},comparisons:[],fullSourceCovered:true,publicationQuality:true,issues:[],fidelityLedger:{sourceCoverage:{u1:{disposition:'PRESERVED',explanation:'source meaning',comparisons:{title:[{sourceSpan:select(text,'source'),candidateSpan:select(title,'candidate:title'),sourceState:state,candidateState:state,assessment:'PRESERVED',explanation:'independent meaning'}]}}},claims:{title:{explanation:'claim meaning',components:[{span:select(title,'candidate:title'),sourceUnitIds:['u1'],verdict:'SUPPORTED',explanation:'grounded'}]}}}};
 return {raw,contract,publication,text};
}
for(const text of ['خبر إيران','#حسن_نصرالله قال خبر إيران.','قائم‌پناه در ایران گفت.','Iran announced a meeting.','إيران — Iran ۱۲٣','🔺 إيران.'])test('exact immutable coordinates '+text,()=>{
 const x=extraction(text),decoded=normalExtractionSchema.parse(x.contract.decode(x.raw));const e=decoded.statements[0].evidence;
 assert.equal(e.excerpt,text);assert.equal(text.slice(e.startOffset!,e.endOffset!),text);assert.equal(decoded.coverage[0].factIds[0],'f1');assert.equal(text,x.contract.input&&(x.contract.input as {content:string}).content);
});
test('normal extraction consumes application fact IDs and complete coverage',()=>{const x=extraction();const decoded=x.contract.decode(x.raw),p=normalSelection(decoded,source),v=validateMinimalExtraction(p.extraction,source);assert.equal(v.statements[0].id,'f1');assert.doesNotThrow(()=>validateNormalExtractionCoverage(source,v,p.extraction,p.coverage,true));});
for(const mode of ['unknown','synonym','candidate namespace','reversed','off-by-one'])test('invalid evidence selection '+mode,()=>{
 const c=spanCatalog(source,'source'),v=select(source,'source');if(mode==='reversed')[v.first,v.last]=[v.last,v.first];else Reflect.set(v,'first',mode==='candidate namespace'?'candidate:title:0':mode==='synonym'?'denial':mode==='off-by-one'?c.atoms.length:'missing');assert.throws(()=>c.resolve(v));
});
test('same spelling different occurrence has distinct exact immutable IDs',()=>{const text='إيران ثم إيران';const a=select(text,'source','إيران',0),b=select(text,'source','إيران',1);assert.notEqual(a.first,b.first);assert.equal(spanCatalog(text,'source').resolve(b).startOffset,9);});
test('different source cannot reuse request identity',()=>{const a=extraction(),b=extraction(source+' جديد');assert.throws(()=>b.contract.decode(a.raw));});
for(const mode of ['f5','unknown unit','missing coverage','conflicting nonfactual','duplicate association','wrong digest'])test('coverage never guesses '+mode,()=>{
 const x=extraction();if(mode==='f5')Object.assign(x.raw.statements[0],{id:'f5'});if(mode==='unknown unit')Object.assign(x.raw.unitCoverage,{u999:{statementIndices:[0],nonFactual:false}});if(mode==='missing coverage')x.raw.statements=[];if(mode==='conflicting nonfactual')x.raw.unitCoverage.u1.nonFactual=true;if(mode==='duplicate association')x.raw.unitCoverage.u1.statementIndices=[0,0];if(mode==='wrong digest')x.raw.catalogId='wrong';assert.throws(()=>x.contract.decode(x.raw));
});
test('keyed receipt produces canonical IDs/cardinality without prose echo',()=>{const x=receipt(),v=x.contract.decode(x.raw) as {review:{id:string}[];fidelityLedger:unknown};assert.deepEqual(v.review.map(r=>r.id),['title']);assert.doesNotThrow(()=>validateFidelityLedger(x.text,x.publication,v.fidelityLedger));});
for(const mode of ['missing','unknown','duplicate JSON','conflicting JSON','namespace','digest','source unit'])test('receipt fails closed '+mode,()=>{
 const x=receipt();if(mode.includes('JSON')){const value=mode==='duplicate JSON'?'1':'2';assert.throws(()=>parseProviderJson('{"review":{"title":1,"title":'+value+'}}'),/DUPLICATE_PROVIDER_KEY/);return;}
 if(mode==='missing')Reflect.deleteProperty(x.raw.review,'title');if(mode==='unknown')Object.assign(x.raw.review,{unknown:x.raw.review.title});if(mode==='namespace')Reflect.set(x.raw.fidelityLedger.claims.title.components[0].span,'first','source:0');if(mode==='digest')x.raw.catalogId='wrong';if(mode==='source unit')x.raw.fidelityLedger.claims.title.components[0].sourceUnitIds=['u999'];assert.throws(()=>x.contract.decode(x.raw));
});
test('duplicate escaped JSON key cannot hide negative result',()=>assert.throws(()=>parseProviderJson('{"title":1,"\\u0074itle":2}'),/DUPLICATE_PROVIDER_KEY/));
test('nested objects may reuse keys and strings may contain braces',()=>assert.deepEqual(parseProviderJson('{"a":{"id":"}"},"b":{"id":"{"}}'),{a:{id:'}'},b:{id:'{'}}));
for(const text of ['{','{"review":','{"a":1'])test('truncated response fails '+text,()=>assert.throws(()=>parseProviderJson(text)));
test('incomplete component accounting still blocks',()=>{const x=receipt();x.raw.fidelityLedger.claims.title.components[0].span=select(source,'candidate:title','إيران');const v=x.contract.decode(x.raw) as {fidelityLedger:unknown};assert.throws(()=>validateFidelityReceipt(x.text,x.publication,v.fidelityLedger),/REVIEW_RECEIPT_INVALID/);});
for(const defect of ['planned to completed','past to current','possible to asserted','conditional to unconditional','wrong speaker','unsupported purpose','number','date','location','institution to person'])test('structured negative survives mechanical decode: '+defect,()=>{
 const x=receipt();x.raw.fidelityLedger.claims.title.components[0].verdict='UNSUPPORTED';x.raw.fidelityLedger.claims.title.components[0].explanation='This is fully supported (lying rationale)';const v=x.contract.decode(x.raw) as {fidelityLedger:unknown};assert.throws(()=>validateFidelityLedger(x.text,x.publication,v.fidelityLedger),/INDEPENDENT_FIDELITY_FAILED/);
});
test('temporal contradiction blocks even when rationale and parent verdict claim support',()=>{
 const x=receipt();x.raw.fidelityLedger.sourceCoverage.u1.comparisons.title[0].candidateState={...state,phase:'PLANNED'};const v=x.contract.decode(x.raw) as {fidelityLedger:unknown};assert.throws(()=>validateFidelityLedger(x.text,x.publication,v.fidelityLedger));
});
test('material omission remains blocked',()=>{const x=receipt();x.raw.fidelityLedger.sourceCoverage.u1.disposition='MISSING';const v=x.contract.decode(x.raw) as {fidelityLedger:unknown};assert.throws(()=>validateFidelityLedger(x.text,x.publication,v.fidelityLedger));});
test('faithful paraphrase is not compared lexically against source',()=>{const x=receipt('افتتحت إيران مدرسة جديدة.','مدرسة جديدة افتتحتها إيران.');const v=x.contract.decode(x.raw) as {fidelityLedger:unknown};assert.doesNotThrow(()=>validateFidelityLedger(x.text,x.publication,v.fidelityLedger));});
test('wrong known occurrence does not imply semantic support',()=>{const x=receipt('قال زيد نعم وقال عمر لا.');x.raw.fidelityLedger.claims.title.components[0].verdict='UNSUPPORTED';const v=x.contract.decode(x.raw) as {fidelityLedger:unknown};assert.throws(()=>validateFidelityLedger(x.text,x.publication,v.fidelityLedger));});
test('frozen post76 correction selects immutable occurrence without coordinate arithmetic',()=>{
 const p=frozen.find(p=>p.externalId==='76')!,raw=p.outputs[0].output;const plan=evidenceMetadataPlan(p.normalized,raw,normalExtractionSchema),wire=evidenceMetadataWire(plan);const slot=plan.slots[0],candidate=wire.input.slots[0].candidates.find(c=>c.startOffset===88)!;
 const result=wire.decode({catalogId:plan.identity,selections:{[slot.fieldId]:candidate.id}});assert.equal(result.corrections[0].endOffset,93);assert.doesNotThrow(()=>graftEvidenceMetadata(plan,result));assert.throws(()=>wire.decode({catalogId:plan.identity,selections:{[slot.fieldId]:'unknown'}}));assert.throws(()=>graftEvidenceMetadata(plan,{corrections:[{fieldId:slot.fieldId,status:'RESOLVED',startOffset:89,endOffset:93}]}));
});
test('empty media input creates no evidence catalog or invented story',()=>assert.equal(bookkeepingContract('extract',{content:''},normalExtractionSchema),null));
test('all thirteen frozen failures remain immutable and do not contain provider signatures',()=>{assert.equal(frozen.length,13);assert(!JSON.stringify(frozen).includes('thoughtSignature'));assert.equal(frozen.find(p=>p.externalId==='119466')!.normalized,'');});

test('catalog cannot be mutated to authorize a different coordinate',()=>{const c=spanCatalog(source,'source');assert(Object.isFrozen(c.atoms));assert(Object.isFrozen(c.atoms[0]));assert.equal(Reflect.defineProperty(c.atoms[0],'start',{value:999}),false);});
test('canonical branding has the same exemption in component and whole-text accounting',()=>{
 const text='افتتحت إيران مدرسة جديدة.',title='إيران الآن | '+text,x=receipt(text,title);
 x.raw.fidelityLedger.claims.title.components[0].span=select(title,'candidate:title',text);
 const v=x.contract.decode(x.raw) as {fidelityLedger:unknown};assert.doesNotThrow(()=>validateFidelityLedger(x.text,x.publication,v.fidelityLedger));
});
test('unaccounted prose is not excused merely because it follows branding',()=>{
 const text='افتتحت إيران مدرسة جديدة.',title='إيران الآن | '+text+' لتحقيق مكاسب.',x=receipt(text,title);
 x.raw.fidelityLedger.claims.title.components[0].span=select(title,'candidate:title',text);
 const v=x.contract.decode(x.raw) as {fidelityLedger:unknown};assert.throws(()=>validateFidelityLedger(x.text,x.publication,v.fidelityLedger));
});
test('context span cannot point to an unrelated source unit',()=>{const x=extraction('إيران أعلنت خبراً.\nورد تفصيل آخر.');x.raw.statements[0].evidence.context={firstUnit:'u2',lastUnit:'u2'};assert.throws(()=>x.contract.decode(x.raw));});
for(const [name,a,b] of [
 ['planned/completed','تخطط إيران لافتتاح مدرسة.','افتتحت إيران مدرسة.'],
 ['possible/asserted','قد تعلن إيران القرار.','أعلنت إيران القرار.'],
 ['conditional/unconditional','إذا وافق المجلس ستفتتح إيران المدرسة.','ستفتتح إيران المدرسة.'],
 ['past/current','كانت المحادثات تتم عبر الوسطاء.','المحادثات المستمرة تجري عبر الوسطاء.'],
 ['attribution','قال وزير الخارجية الإيراني إن الاجتماع انتهى.','قال الرئيس الإيراني إن الاجتماع انتهى.'],
 ['purpose','افتتحت إيران مدرسة.','افتتحت إيران مدرسة لتحقيق مكاسب سياسية.'],
] as const)test('one material change remains rejected with grounded negative: '+name,()=>{
 const x=receipt(a,b);x.raw.fidelityLedger.claims.title.components[0].verdict='UNSUPPORTED';
 const decoded=x.contract.decode(x.raw) as {fidelityLedger:unknown};assert.throws(()=>validateFidelityLedger(a,x.publication,decoded.fidelityLedger),/INDEPENDENT_FIDELITY_FAILED/);
});
for(const [a,b] of [['أعلنت إيران افتتاح 12 مدرسة.','أعلنت إيران افتتاح 13 مدرسة.'],['أعلنت إيران الاجتماع في 12 سبتمبر.','أعلنت إيران الاجتماع في 13 سبتمبر.']])test('objective number/date safeguard retained '+b,()=>assert.throws(()=>validateObjectiveArticle(a,b,'')));

test('new DIRECT wire reaches mandatory V4.4 with canonical contract intact; no fabricated result',async()=>{
 process.env.SHADOW_MODE='true';process.env.AUTO_PUBLISH='false';let calls=0;
 const text='افتتحت إيران مدرسة جديدة.';
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
  calls++;const body=JSON.parse(String(init?.body)),data=JSON.parse(body.contents[0].parts[0].text);
  if(data.version==='proposition-support-v4.4')throw new ProcessingError('OFFLINE_NEXT_STAGE_REQUIRED');
  assert.equal(body.systemInstruction.parts[0].text.split(editorialContract).length,2);
  let output:unknown;
  if(data.content){const x=extraction(text);const {catalogId:unused,...raw}=x.raw;void unused;
   output={catalogId:data.bookkeeping.catalogId,extraction:{...raw,statements:raw.statements.map(s=>({...s,kind:'FACT',material:true})),safety:{filterReason:'NONE',priority:'P3',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}},article:{title:'إيران الآن | '+text,body:'',diagnostics:[]}};
  }else{const x=receipt(text,data.publication[0].text);x.raw.catalogId=data.bookkeeping.catalogId;output=x.raw;}
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:0,candidatesTokenCount:0,thoughtsTokenCount:0}});
 });
 await assert.rejects(p.understand({content:text,processingMode:'DIRECT',publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal),/OFFLINE_NEXT_STAGE_REQUIRED/);
 assert.equal(calls,3);
});

test('valid keyed temporal diagnosis reaches bounded R1, not a receipt retry',async()=>{
 process.env.SHADOW_MODE='true';process.env.AUTO_PUBLISH='false';
 const text='تخطط إيران لافتتاح مدرسة.',title='إيران الآن | افتتحت إيران مدرسة.';let calls=0,repairCycle:number|undefined;
 const p=new GeminiLanguageProvider('offline',async(_url,init)=>{
  calls++;const body=JSON.parse(String(init?.body)),data=JSON.parse(body.contents[0].parts[0].text);
  if(data.repair){repairCycle=data.repair.cycle;assert(data.repair.diagnostics.length);throw new ProcessingError('OFFLINE_NEXT_STAGE_REQUIRED');}
  let output:unknown;
  if(data.content){const x=extraction(text);const {catalogId:unused,...raw}=x.raw;void unused;output={catalogId:data.bookkeeping.catalogId,extraction:{...raw,statements:raw.statements.map(s=>({...s,kind:'FACT',material:true})),safety:{filterReason:'NONE',priority:'P3',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}},article:{title,body:'',diagnostics:[]}};}
  else{assert(!data.receiptCorrection);const x=receipt(text,title);x.raw.catalogId=data.bookkeeping.catalogId;x.raw.review.title.verdict='UNSUPPORTED';x.raw.fidelityLedger.claims.title.components[0].verdict='UNSUPPORTED';const t=x.raw.fidelityLedger.sourceCoverage.u1.comparisons.title[0];t.sourceState={...state,time:'FUTURE',phase:'PLANNED'};t.assessment='CHANGED';output=x.raw;}
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:0,candidatesTokenCount:0,thoughtsTokenCount:0}});
 });
 await assert.rejects(p.understand({content:text,processingMode:'DIRECT',publishedAt:new Date(),profile:unknownProfile,rules:ruleSet},new AbortController().signal),/OFFLINE_NEXT_STAGE_REQUIRED/);assert.equal(repairCycle,1);assert.equal(calls,3);
});
