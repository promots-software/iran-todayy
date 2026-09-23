import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {minimalExtractionSchema,validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {validateSpeakerEvidence} from '../src/lib/processing/speaker-evidence';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
import {publicationUnits,validateSourceCoverage,validateObjectiveArticle} from '../src/lib/processing/direct-publication';
import {preserveGroundedExtraction,mergeDiagnosedRepair} from '../src/lib/processing/repair-integrity';
import {normalStage} from '../src/lib/processing/normal-v2';
import {ProcessingError} from '../src/lib/processing/contracts';
import {editorialContract,EDITORIAL_CONTRACT_SHA256} from '../src/lib/processing/editorial-contract';
import {adaptIdClassification,classificationReferences} from '../src/lib/processing/id-classification';
import {publicationDraft,validatePublicationReviewProtocol} from '../src/lib/processing/direct-publication';
import {directFinalArticle,directMatchingUnderstanding} from '../src/lib/processing/direct-generation';
import {repairDiagnosticSummary} from '../src/lib/processing/diagnostic-summary';
import {dateTokens} from '../src/lib/processing/text-equivalence';

type Row={case:number;source:string;telegramId:string;sourceText:string;outputs:Record<string,unknown>[]};
const rows=JSON.parse(readFileSync('tests/fixtures/semantic-integrity-production-ten.json','utf8')) as Row[];
function extraction(raw:Record<string,unknown>){return Object.fromEntries(Object.keys(minimalExtractionSchema.shape).map(k=>[k,raw[k]]));}
for(const row of rows.filter(r=>r.case!==9))test(`production ${row.case} / ${row.telegramId}: unchanged stored evidence replay`,()=>{
 const initial=()=>validateMinimalExtraction(extraction(row.outputs[0]),row.sourceText);
 const repaired=()=>validateMinimalExtraction(extraction(row.outputs[1]),row.sourceText);
 if(row.case===3){assert.throws(initial,/INVALID_EVIDENCE/);assert.throws(repaired,/INVALID_EVIDENCE/);return;}
 if([5,7].includes(row.case))assert.throws(initial,/AMBIGUOUS_EVIDENCE_CONTEXT/);else assert(initial().statements.length);
 assert(repaired().statements.length);
 // This proves objective extraction, not semantic correctness, final article
 // quality or READY. In case 1 the historical repair deleted valid attribution.
 if(row.case===1){
  const merged=validateMinimalExtraction(preserveGroundedExtraction(extraction(row.outputs[0]),extraction(row.outputs[1]),row.sourceText),row.sourceText);
  assert(merged.statements.every(s=>s.speaker));
 }
});
test('production 9: invalid review IDs and fabricated direct quotation remain defects',()=>{
 const row=rows.find(r=>r.case===9)!;
 const draft=row.outputs[3] as {publication:{title:{text:string};body:{text:string}[]}};
 const review=row.outputs[4] as {review:{id:string}[]};
 assert.notDeepEqual(review.review.map(r=>r.id),['title',...draft.publication.body.map((_,i)=>`body:${i+1}`)]);
 const repaired=row.outputs[5] as typeof draft;
 assert.throws(()=>validateObjectiveArticle(row.sourceText,repaired.publication.title.text,repaired.publication.body.map(p=>p.text).join('\n')),/QUOTE_MISMATCH/);
});
const evidence=(source:string,text:string)=>({excerpt:text,start:source.indexOf(text),end:source.indexOf(text)+text.length});
const offsetRows=JSON.parse(readFileSync('tests/fixtures/semantic-offset-production.json','utf8')) as {telegramId:string;source:string;outputs:Record<string,unknown>[]}[];
for(const row of offsetRows)for(const [i,output] of row.outputs.entries())test(`fresh production ${row.telegramId}/${i}: offsets computed from exact source context`,()=>{
 if(!('relevance' in output)){
  const u=directMatchingUnderstanding(output,row.source);
  for(const f of u.event.facts)assert.equal(row.source.slice(f.evidence.start,f.evidence.end),f.evidence.excerpt);
  return;
 }
 const raw=extraction(output);
 const grounded=validateMinimalExtraction(raw,row.source);
 for(const e of [...grounded.actors,grounded.action,grounded.object,grounded.location,...grounded.statements.flatMap(s=>[s.evidence,s.speaker])])if(e)assert.equal(row.source.slice(e.start,e.end),e.excerpt);
});
test('bad model range cannot bypass evidence identity or ambiguity',()=>{
 for(const offsets of [{startOffset:99,endOffset:100},{startOffset:1,endOffset:3}]){
  assert.throws(()=>resolveContextEvidence({excerpt:'غير موجود',context:'نص متكرر نص',...offsets},'نص متكرر نص'),/INVALID_EVIDENCE/);
  assert.throws(()=>resolveContextEvidence({excerpt:'نص',context:'نص متكرر نص',...offsets},'نص متكرر نص'),/AMBIGUOUS_EVIDENCE_CONTEXT/);
  const e={excerpt:'نص',context:'متكرر نص',...offsets};resolveContextEvidence(e,'نص متكرر نص');assert.equal(Object(e).start,9);
 }
});
for(const [speaker,assertion,layout] of [
 ['أمينة رابطة مخططي الساحل ليلى صادق','أقرت الرابطة برنامجاً جديداً.','توضح'],
 ['مجمع بحوث النهر','بدأت دراسة مستقلة.','يستعرض'],
 ['هيئة أرشيف المدينة','ستتاح السجلات غداً.','يفيد'],
 ['رئيس وحدة العلوم سامر نادر','أُنجزت الدراسة.','يعلن'],
])for(const separator of [':\n• ','، ',' — ','\n\n'])test(`unseen semantic attribution: ${speaker} / ${JSON.stringify(separator)}`,()=>{
 const source=`${speaker}${separator}${layout}: ${assertion}`;
 assert.doesNotThrow(()=>validateSpeakerEvidence(source,evidence(source,assertion),evidence(source,speaker)));
 assert.throws(()=>validateSpeakerEvidence(source,evidence(source,assertion),{...evidence(source,speaker),excerpt:'شخص آخر'}),/INVALID_EVIDENCE/);
});
test('repeated word resolved by verified range, not first occurrence',()=>{
 const source='تحدث المسؤول ثم تحدث المجلس.';const start=source.lastIndexOf('تحدث');
 const value={excerpt:'تحدث',context:source,startOffset:start,endOffset:start+4};
 resolveContextEvidence(value,source);assert.equal(Object(value).start,start);
 assert.throws(()=>resolveContextEvidence({excerpt:'تحدث',context:source},source),/AMBIGUOUS/);
 assert.throws(()=>resolveContextEvidence({...value,startOffset:1,endOffset:5,context:source},source),/AMBIGUOUS_EVIDENCE_CONTEXT/);
});
test('verbatim means exact characters, including whitespace and invented ellipses',()=>{
 for(const excerpt of ['اختار ... المقر','اختار  المقر'])assert.throws(()=>resolveContextEvidence({excerpt,context:'اختار المقر'},'اختار المقر'),/INVALID_EVIDENCE/);
});
test('semantic unit mapping: repeated headline, unfamiliar brand/footer and factual hashtag',()=>{
 const source='مرصد الزمرد | افتتاح مكتبة\nافتتح المجلس مكتبة في #البصرة.\n#مرصد_الزمرد\n◆';
 const facts=[{id:'f1',evidence:evidence(source,'افتتح المجلس مكتبة في #البصرة.')}];
 const units=publicationUnits(source);
 const mapping=units.map((u,i)=>({unitId:u.id,nonFactual:i>1,factIds:i>1?[]:['f1']}));
 assert.doesNotThrow(()=>validateSourceCoverage(source,{event:{facts}},mapping));
 assert.throws(()=>validateSourceCoverage(source,{event:{facts}},mapping.slice(1)),/COVERAGE/);
 assert.throws(()=>validateSourceCoverage(source,{event:{facts}},mapping.map((m,i)=>i===0?{...m,factIds:['missing']}:m)),/COVERAGE/);
});
test('unique headline material cannot disappear from declared coverage',()=>{
 const source='افتتاح 3 مكتبات\nافتتح المجلس مكتبة.';
 const facts=[{id:'f1',evidence:evidence(source,'افتتاح 3 مكتبات')},{id:'f2',evidence:evidence(source,'افتتح المجلس مكتبة.')}];
 assert.throws(()=>validateSourceCoverage(source,{event:{facts}},publicationUnits(source).map(u=>({unitId:u.id,nonFactual:false,factIds:['f2']}))),/COVERAGE/);
});
for(const [source,output,error] of [
 ['افتتحت اللجنة 3 مدارس.','افتتحت اللجنة 4 مدارس.','NUMBER'],
 ['أعلنت اللجنة الموعد في 12 أيلول.','أعلنت اللجنة الموعد في 13 أيلول.','NUMBER'],
 ['قالت اللجنة إن العمل بدأ.','قالت اللجنة «انتهى العمل».','QUOTE'],
])test(`objective final integrity ${error}`,()=>assert.throws(()=>validateObjectiveArticle(source,output,''),new RegExp(error)));
test('targeted extraction merge preserves valid statements, speakers, numbers and IDs',()=>{
 const source='قال المجلس: افتتحنا 3 مدارس. وأعلن موعداً جديداً.';
 const e=(excerpt:string)=>({excerpt,context:source});
 const previous={actors:[e('المجلس')],action:e('افتتحنا ... مدارس'),statements:[{evidence:e('افتتحنا 3 مدارس.'),speaker:e('المجلس')}]};
 const next={actors:[],action:e('افتتحنا'),statements:[{evidence:e('أعلن موعداً جديداً'),speaker:null}]};
 const merged=preserveGroundedExtraction(previous,next,source) as typeof previous;
 assert.deepEqual(merged.statements,previous.statements);assert.deepEqual(merged.actors,previous.actors);assert.deepEqual(merged.action,next.action);
});
test('targeted draft merge cannot delete unrelated copy',()=>{
 const before={publication:{title:{text:'عنوان صحيح',factIds:['f1']},body:[{text:'نص غير صحيح',factIds:['f1']}]}};
 const next={publication:{title:{text:'تغيير غير مطلوب',factIds:['f2']},body:[{text:'النص المصحح',factIds:['f1']}]}};
 const merged=mergeDiagnosedRepair(before,next,{stage:'draft',code:'INVALID',issues:[{code:'INVALID',path:['publication','body',0,'text']}],instructions:''}) as typeof before;
 assert.deepEqual(merged.publication.title,before.publication.title);assert.equal(merged.publication.body[0].text,'النص المصحح');
});
test('one bounded repair preserves separate initial/repair diagnostics',async()=>{
 let calls=0;
 await assert.rejects(normalStage('extract',async()=>{calls++;throw new ProcessingError(calls===1?'INVALID_EVIDENCE':'AMBIGUOUS_EVIDENCE_CONTEXT',false,{stage:'extract',issues:[{code:'BAD_SPAN',path:['action']}]});}),error=>{
  assert(error instanceof ProcessingError);assert.equal(error.code,'AI_SCHEMA_REPAIR_FAILED');
  const diagnostic=error.diagnostic as {initialFailure:{code:string};repairFailure:{code:string}};
  assert.equal(diagnostic.initialFailure.code,'INVALID_EVIDENCE');assert.equal(diagnostic.repairFailure.code,'AMBIGUOUS_EVIDENCE_CONTEXT');return true;
 });assert.equal(calls,2);
});
test('canonical file preserved byte-for-byte, complete 40 sections',()=>{
 assert.equal(createHash('sha256').update(readFileSync('config/editorial/iran-now-contract.txt')).digest('hex'),EDITORIAL_CONTRACT_SHA256);
 assert.equal(EDITORIAL_CONTRACT_SHA256,'9782065875b461bcd02951a0496acb397f13750af9611253abc4b2ecbd466456');
 assert.deepEqual([...editorialContract.matchAll(/^(\d+)\. /gm)].map(m=>Number(m[1])),Array.from({length:40},(_,i)=>i+1));
});
for(const row of rows.filter(r=>![3,9].includes(r.case)))test(`production ${row.case}: grounded extraction is never a publication receipt`,()=>{
 const x=validateMinimalExtraction(extraction(row.outputs[1]),row.sourceText),refs=classificationReferences(x);
 const u=adaptIdClassification(x,{anchorIds:refs.requiredAnchorIds,factLabels:x.statements.map(f=>({id:f.id,kind:f.speaker?'STATEMENT':'FACT',material:true})),filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:refs.requiredFactIds},row.sourceText);
 assert.throws(()=>publicationDraft(row.sourceText,u));
 assert.throws(()=>directFinalArticle(row.sourceText,u),/RECEIPT_REQUIRED/);
});
test('review protocol requires title/body IDs, not extraction IDs',()=>{
 const row=rows.find(r=>r.case===9)!;
 assert.throws(()=>validatePublicationReviewProtocol(row.outputs[4],2),/REVIEW_FAILED/);
});
test('operator diagnostics show both causes without arbitrary payloads',()=>{
 const result=repairDiagnosticSummary({diagnostic:{initialFailure:{code:'INVALID_EVIDENCE',issues:[{path:['action']}]},repairFailure:{code:'AMBIGUOUS_EVIDENCE_CONTEXT',issues:[{path:['statements',0,'speaker']}]},output:{secret:'never display'}}});
 assert.deepEqual(result,{initial:{code:'INVALID_EVIDENCE',paths:['action']},repair:{code:'AMBIGUOUS_EVIDENCE_CONTEXT',paths:['statements.0.speaker']}});
 assert.deepEqual(repairDiagnosticSummary({diagnostic:{initialFailure:{code:'https://private?token=value',issues:[]}}}),{initial:null,repair:null});
});
test('date tokens have lexical boundaries, not substrings of unrelated place names',()=>{
 assert.deepEqual(dateTokens('بغداد'),[]);assert.deepEqual(dateTokens('المستقبل'),[]);
 assert(dateTokens('يبدأ غداً').includes('غدا'));
});


test('repair transport failure preserves original retry policy and initial diagnosis',async()=>{
 let calls=0;
 await assert.rejects(normalStage('draft',async()=>{if(++calls===1)throw new ProcessingError('INVALID_DRAFT_FACT_LINK');throw new ProcessingError('GEMINI_HTTP_503',true,undefined,1200);}),error=>{
  assert(error instanceof ProcessingError);assert.equal(error.code,'GEMINI_HTTP_503');assert.equal(error.retryable,true);assert.equal(error.retryAfterMs,1200);
  assert.equal(repairDiagnosticSummary({diagnostic:error.diagnostic}).initial?.code,'INVALID_DRAFT_FACT_LINK');return true;
 });assert.equal(calls,2);
});


test('a revisited review stage cannot spend a second repair after a draft repair',async()=>{
 let used=false,calls=0;const budget=()=>{if(used)return false;used=true;return true;};
 const first=await normalStage('publication_review',async repair=>{calls++;if(!repair)throw new ProcessingError('DIRECT_PUBLICATION_REVIEW_FAILED');return 'valid';},undefined,undefined,budget);
 assert.equal(first,'valid');
 await assert.rejects(normalStage('publication_review',async()=>{calls++;throw new ProcessingError('DIRECT_PUBLICATION_REVIEW_FAILED');},undefined,undefined,budget),error=>{
  assert(error instanceof ProcessingError);assert.equal(error.code,'AI_SCHEMA_REPAIR_FAILED');assert.equal(repairDiagnosticSummary({diagnostic:error.diagnostic}).repair?.code,'REPAIR_BUDGET_EXHAUSTED');return true;
 });assert.equal(calls,3);
});
