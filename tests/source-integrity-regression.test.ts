import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceUnits} from '../src/lib/processing/source-units';
import {structurallyEqual} from '../src/lib/processing/structural-integrity';
import {resolveContextEvidence,requireArabic} from '../src/lib/processing/groq-validation';
import {validateSourceCoverage} from '../src/lib/processing/direct-publication';

test('presentation units preserve original offsets and substantive paragraphs',()=>{
 const source='قالت الهيئة: بدأ العمل.\n\u200b\n— —\n\u200f\nخبر ثانٍ.\n📲 @agency\n#خبر';
 const units=sourceUnits(source);
 assert.deepEqual(units.map(u=>u.id),['u1','u5','u6','u7']);
 for(const u of units)assert.equal(source.slice(u.start,u.end),u.text);
 assert.equal(units[2].kind,'DISTRIBUTION');
 assert.equal(units[3].kind,'CONTENT'); // A hashtag can carry material meaning.
 const facts=[{id:'f1',evidence:{start:0,end:source.indexOf('\n'),excerpt:units[0].text}}];
 assert.throws(()=>validateSourceCoverage(source,{event:{facts}},[{unitId:'u1',factIds:['f1'],nonFactual:false}]),/COVERAGE/);
});
test('Persian joiners within lexical source units remain untouched',()=>{
 const source='می\u200cرود\nایران\u200d';
 assert.equal(sourceUnits(source).map(u=>u.text).join('\n'),source);
});
test('database key ordering is not receipt identity; changed values still differ',()=>{
 const a={version:1,article:{title:'خبر',body:'النص'},facts:['f1','f2']};
 assert(structurallyEqual(a,{facts:['f1','f2'],article:{body:'النص',title:'خبر'},version:1}));
 assert(!structurallyEqual(a,{...a,article:{title:'خبر آخر',body:'النص'}}));
 assert(!structurallyEqual(a,{...a,facts:['f2','f1']}));
});
test('exact evidence range tolerates only layout differences in context',()=>{
 const source='قالت الهيئة:\n\u200b\nبدأ العمل.';
 const e={excerpt:'الهيئة',startOffset:5,endOffset:11,context:'قالت الهيئة: بدأ العمل.'};
 assert.doesNotThrow(()=>resolveContextEvidence(e,source));
 assert.equal(Object(e).start,5);
 assert.throws(()=>resolveContextEvidence({excerpt:'الهيئة',startOffset:5,endOffset:11,context:'قالت الهيئة: انتهى العمل.'},source),/CONTEXT/);
});
test('repeated evidence without a unique context is still rejected',()=>{
 assert.throws(()=>resolveContextEvidence({excerpt:'نيويورك',context:'نيويورك ثم نيويورك',startOffset:1,endOffset:8},'نيويورك ثم نيويورك'),/AMBIGUOUS/);
});
test('final generated Arabic requirements are unchanged',()=>{
 assert.throws(()=>requireArabic('تلمیذا وتلمیذة'),/NON_ARABIC_OUTPUT/);
 assert.doesNotThrow(()=>requireArabic('تلميذا وتلميذة'));
});

import {preserveGroundedExtraction,mergeDiagnosedRepair} from '../src/lib/processing/repair-integrity';
import {unsupportedQuotes} from '../src/lib/processing/quote-integrity';

test('extraction repair preserves occurrence identities across array reordering and remaps coverage',()=>{
 const source='قالت الهيئة: افتتحت 3 مدارس. أعلنت اللجنة موعداً.';
 const e=(excerpt:string)=>({excerpt,context:source});
 const a={evidence:e('افتتحت 3 مدارس.'),speaker:e('الهيئة')};
 const b={evidence:e('أعلنت اللجنة موعداً.'),speaker:null};
 const before={actors:[e('الهيئة'),e('اللجنة')],statements:[a,b]};
 const next={actors:[e('اللجنة'),e('الهيئة')],statements:[b,a],coverage:[{unitId:'u1',factIds:['f2','f1'],nonFactual:false}]};
 const result=preserveGroundedExtraction(before,next,source) as typeof next;
 assert.deepEqual(result.statements,[a,b]);assert.deepEqual(result.actors,before.actors);
 assert.deepEqual(result.coverage[0].factIds,['f1','f2']);
 assert.deepEqual(next.statements,[b,a]);
 assert.throws(()=>preserveGroundedExtraction(before,{...next,statements:[b]},source),/IDENTITY_CHANGED/);
 assert.throws(()=>preserveGroundedExtraction(before,{...next,statements:[b,{...a,speaker:null}]},source),/IDENTITY_CHANGED/);
});
test('repair outside first diagnosed field is not replaced with stale unsupported prose',()=>{
 const previous={publication:{title:{text:'عنوان',factIds:['f1']},body:[{text:'خطأ اقتباس',factIds:['f1']},{text:'إضافة غير مسندة',factIds:['f1']}]}};
 const candidate={publication:{title:previous.publication.title,body:[{text:'الاقتباس الصحيح',factIds:['f1']},{text:'النص المسند',factIds:['f1']}]}};
 assert.deepEqual(mergeDiagnosedRepair(previous,candidate,{stage:'draft',code:'QUOTE',issues:[{path:['publication','body',0]}],instructions:''}),candidate);
});
test('quote delimiters may change; source literal words cannot change',()=>{
 assert.deepEqual(unsupportedQuotes('قال: “لن نتراجع”.','قال: «لن نتراجع».'),[]);
 assert.deepEqual(unsupportedQuotes('قال: «سنتراجع».','قال: «لن نتراجع».'),['«سنتراجع»']);
 assert.deepEqual(unsupportedQuotes('قال: «العمل مستمر».','العمل مستمر.'),['«العمل مستمر»']);
});
test('grounded entity and terminology typography does not attest invented direct speech',()=>{
 assert.deepEqual(unsupportedQuotes('قالت شبكة «سي إن إن» إن اللقاء عُقد.','قالت شبكة سي إن إن إن اللقاء عُقد.'),[]);
 assert.deepEqual(unsupportedQuotes('أعلنت شركة “الأفق” الموعد.','أعلنت شركة الأفق الموعد.'),[]);
 assert.deepEqual(unsupportedQuotes('ناقشت «إسرائيل» الطلب.','ناقشت إسرائيل الطلب.'),[]);
 assert.deepEqual(unsupportedQuotes('قالت شبكة «أخرى» إن اللقاء عُقد.','قالت شبكة سي إن إن إن اللقاء عُقد.'),['«أخرى»']);
});

import {numericTokens} from '../src/lib/processing/text-equivalence';
import {validateObjectiveArticle} from '../src/lib/processing/direct-publication';
test('written compound ordinals compare with digits without authorizing a changed number',()=>{
 assert.deepEqual(numericTokens('الدورة الحادية والثمانين و3 مدارس'),['3','81']);
 assert.doesNotThrow(()=>validateObjectiveArticle('الدورة الحادية والثمانين','الدورة الـ81',''));
 assert.throws(()=>validateObjectiveArticle('الدورة الحادية والثمانين','الدورة الـ82',''),/NUMBER/);
 assert.equal(numericTokens('القرن').length,0);
});

test('Arabic source quotation retains source glyphs, generated prose cannot borrow that exception',()=>{
 const source='قال المسؤول إن العمل مستمر: «ستبدأ الشرکة العمل غداً». وأكد استمرار الاستعدادات لاستقبال المواطنين.';
 assert.doesNotThrow(()=>validateObjectiveArticle(source,'المسؤول يعلن استمرار العمل','قال المسؤول: «ستبدأ الشرکة العمل غداً».'));
 assert.throws(()=>validateObjectiveArticle(source,'المسؤول يعلن استمرار العمل','ستبدأ الشرکة العمل غداً.'),/NON_ARABIC_OUTPUT/);
 assert.throws(()=>validateObjectiveArticle(source,'المسؤول يعلن استمرار العمل','قال المسؤول: «أنهت الشرکة العمل».'));
});
test('quoted initialisms require literal source initials, never invented entity aliases',()=>{
 assert.deepEqual(unsupportedQuotes('قالت شركة «يو بي إس».','قالت شركة UPS.'),[]);
 assert.deepEqual(unsupportedQuotes('قالت شركة «يوبيإس».','قالت شركة UPS.'),[]);
 assert.deepEqual(unsupportedQuotes('قالت شركة «يو بي إس».','قالت شركة UN.'),['«يو بي إس»']);
 assert.deepEqual(unsupportedQuotes('قالت شركة «قمر».','قالت شركة القمر.'),['«قمر»']);
});

import {readFileSync} from 'node:fs';
import {minimalExtractionSchema,validateMinimalExtraction} from '../src/lib/processing/groq-extraction';
import {adaptIdClassification,classificationReferences} from '../src/lib/processing/id-classification';
const productionRows=JSON.parse(readFileSync('tests/fixtures/source-integrity-production.json','utf8')) as Array<{id:string;source:string;outputs:Array<{stage:string;output:Record<string,unknown>}>}>;
const extracted=(v:Record<string,unknown>)=>Object.fromEntries(Object.keys(minimalExtractionSchema.shape).map(k=>[k,v[k]]));
for(const id of ['19723','19725','19727'])test(`stored natural ${id}: repaired material remains covered without zero-width facts`,()=>{
 const row=productionRows.find(r=>r.id===id)!;
 const raw=row.outputs.filter(o=>o.stage==='iran_today_extract').at(-1)!.output;
 const x=validateMinimalExtraction(extracted(raw),row.source);
 assert.doesNotThrow(()=>validateSourceCoverage(row.source,{event:{facts:x.statements.map(f=>({...f,speaker:f.speaker?{evidence:f.speaker}:null}))}},raw.coverage));
});
test('stored natural 19726 retains substantive omission rejection',()=>{
 const row=productionRows.find(r=>r.id==='19726')!;
 for(const entry of row.outputs){
  const x=validateMinimalExtraction(extracted(entry.output),row.source);
  assert.throws(()=>validateSourceCoverage(row.source,{event:{facts:x.statements.map(f=>({...f,speaker:f.speaker?{evidence:f.speaker}:null}))}},entry.output.coverage),/COVERAGE/);
 }
});
test('stored natural 19728 remains ambiguous: no arbitrary New York occurrence',()=>{
 const row=productionRows.find(r=>r.id==='19728')!;
 for(const entry of row.outputs)assert.throws(()=>validateMinimalExtraction(extracted(entry.output),row.source),/AMBIGUOUS_EVIDENCE_CONTEXT/);
});

test('stored natural 19731: factual reporting retains its independently grounded attribution',()=>{
 const row=productionRows.find(r=>r.id==='19731')!;
 const raw=row.outputs[0].output;
 const x=validateMinimalExtraction(extracted(raw),row.source);
 assert.doesNotThrow(()=>validateSourceCoverage(row.source,{event:{facts:x.statements.map(f=>({...f,speaker:f.speaker?{evidence:f.speaker}:null}))}},raw.coverage));
 for(const entry of row.outputs.slice(1)){
  const u=adaptIdClassification(x,entry.output,row.source);
  const fact=u.event.facts.find(f=>f.id==='f2')!;
  assert.equal(fact.kind,'FACT');
  assert.deepEqual(fact.speaker?.evidence,x.statements[1].speaker);
  assert.deepEqual(fact.evidence,x.statements[1].evidence);
  assert.equal(fact.verified,false);
  const invalid=structuredClone(entry.output) as {factLabels:Array<{kind:string}>};
  invalid.factLabels[0].kind='STATEMENT';
  assert.throws(()=>adaptIdClassification(x,invalid,row.source),/INVALID_ID_CLASSIFICATION/);
 }
});
test('stored 12153 source glyphs do not become generated-output violations',()=>{
 const row=productionRows.find(r=>r.id==='12153')!;
 const x=validateMinimalExtraction(extracted(row.outputs.at(-1)!.output),row.source);
 const refs=classificationReferences(x);
 assert.doesNotThrow(()=>adaptIdClassification(x,{anchorIds:refs.requiredAnchorIds,factLabels:x.statements.map(f=>({id:f.id,kind:f.speaker?'STATEMENT':'FACT',material:true})),filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:refs.requiredFactIds},row.source));
});

import {preparePublication,acceptPublication,publicationDraft} from '../src/lib/processing/direct-publication';
import {matchEvent} from '../src/lib/processing/matcher';
import type {LanguageProvider} from '../src/lib/processing/contracts';

test('19731 stored replay stops safely where matching context and canonical output were never recorded',async()=>{
 const row=productionRows.find(r=>r.id==='19731')!;
 const x=validateMinimalExtraction(extracted(row.outputs[0].output),row.source);
 const u=adaptIdClassification(x,row.outputs[1].output,row.source);
 assert.equal(u.relevance,'POLITICAL_NEWS');
 assert(row.source.includes('الرئيس الايراني'));
 assert.deepEqual(row.outputs.map(o=>o.stage),['extract','classify','classify']);
 const provider={compare:async()=>{throw new Error('NO_AI_ALLOWED');}} as unknown as LanguageProvider;
 // Empty LOCAL event context checks only the no-existing-event branch. It is
 // not a reconstruction of the unavailable historical production snapshot.
 const match=await matchEvent(u.event,new Date(0),[],provider,new AbortController().signal);
 assert.equal(match.classification,'NEW_EVENT');
 assert.throws(()=>publicationDraft(row.source,u));
 assert.equal(u.publicationProposal,undefined);
});
function groundedRow(id:string){
 const row=productionRows.find(r=>r.id===id)!;
 const raw=row.outputs.find(o=>o.stage==='iran_today_extract')!.output;
 const x=validateMinimalExtraction(extracted(raw),row.source),refs=classificationReferences(x);
 const u=adaptIdClassification(x,{anchorIds:refs.requiredAnchorIds,factLabels:x.statements.map(f=>({id:f.id,kind:f.speaker?'STATEMENT':'FACT',material:true})),filterReason:'NONE',topic:'UNKNOWN',topicEvidenceId:null,priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false,rationaleIds:refs.requiredFactIds},row.source);
 return {row,u};
}
test('stored headline quotation is connected provenance, not an invented body quote',()=>{
 const {row,u}=groundedRow('44257');
 const raw=row.outputs.filter(o=>o.stage==='iran_today_draft').at(-1)!.output;
 const p=preparePublication(row.source,u,raw.publication,raw.coverage);
 assert.equal(p.local,false);
 assert.throws(()=>acceptPublication(row.source,u,p),/REVIEW_FAILED/); // objective fix is not semantic approval
 const changed=structuredClone(raw.publication) as {title:{text:string}};
 changed.title.text=changed.title.text.replace('«صفعة»','«انتصار»');
 assert.throws(()=>preparePublication(row.source,u,changed,raw.coverage),/QUOTE_MISMATCH/);
});

import {finalizeConstrainedDraft} from '../src/lib/processing/local-finalization';
import {directPublicationReceiptSchema} from '../src/lib/processing/direct-publication-contract';
import {unknownProfile} from '../src/lib/processing/contracts';
test('stored 44256 JSONB checkpoint revalidates structurally, while changed copy still fails',()=>{
 const row=productionRows.find(r=>r.id==='44256')!;
 const rawExtraction=row.outputs.find(o=>o.stage==='iran_today_extract')!.output;
 const x=validateMinimalExtraction(extracted(rawExtraction),row.source);
 const u=adaptIdClassification(x,row.outputs.find(o=>o.stage==='iran_today_classify')!.output,row.source);
 const checkpoint=(row as typeof row&{checkpoints:Array<{normalGeneration:unknown;title:string}>}).checkpoints[0];
 u.publicationProposal=directPublicationReceiptSchema.parse(checkpoint.normalGeneration);
 assert.notEqual(JSON.stringify(checkpoint.normalGeneration),JSON.stringify(u.publicationProposal));
 assert.doesNotThrow(()=>finalizeConstrainedDraft(checkpoint,row.source,u,unknownProfile));
 assert.throws(()=>finalizeConstrainedDraft({...checkpoint,title:checkpoint.title+' نص آخر'},row.source,u,unknownProfile),/CHANGED/);
});
