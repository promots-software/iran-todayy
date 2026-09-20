import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editorialScope,coverageInstructions} from '../src/lib/processing/editorial-scope';
import {sourceLanguage,detectSourceLanguage} from '../src/lib/processing/source-language';
import {failurePolicy,retryAfter} from '../src/lib/processing/failure-policy';
import {budgetDecision,limits} from '../src/worker/provider-guard';
import {checkpointCall,type CheckpointStore} from '../src/worker/checkpoints';
import {ProcessingError} from '../src/lib/processing/contracts';
import {validateSpeakerEvidence} from '../src/lib/processing/speaker-evidence';
import {resolveContextEvidence} from '../src/lib/processing/groq-validation';
import {groqRuleContext} from '../src/lib/processing/groq-context';
import {ruleSet} from '../src/lib/processing/rules';
for(const [geo,texts] of Object.entries({
 IRAN:['افتتاح مستشفى جديد في إيران','أمطار غزيرة في طهران','Iran has opened a new hospital in Tehran.'],
 SYRIA:['وزارة الصحة السورية تعلن حملة تلقيح','افتتاح مدرسة جديدة في دمشق'],
 LEBANON:['منتخب لبنان يفوز في المباراة','تساقط الثلوج في بعلبك'],
 PALESTINE:['مصادر فلسطينية: قوات الاحتلال تقتحم بلدة الزيادية جنوب جنين','افتتاح مدرسة جديدة في نابلس'],
 IRAQ:['انطلاق بطولة رياضية في العراق','افتتاح جسر جديد في بغداد'],
 YEMEN:['توقعات بأمطار غزيرة في اليمن','افتتاح مستشفى جديد في صنعاء'],
}))test(`coverage ${geo}: domestic and non-political/city-only evidence`,()=>{
 for(const text of texts){const scope=editorialScope(text);assert.equal(scope.status,'IN_SCOPE',text);assert.ok(scope.geographies.includes(geo as never));}
});
test('scope never supplies language or institution identity; foreign mention alone cannot filter',()=>{
 const ar='تساقط الثلوج في فرنسا',fa='بارش برف در کشور آلمان';
 assert.equal(sourceLanguage(ar),'ar');assert.equal(sourceLanguage(fa),'fa');
 assert.equal(editorialScope(ar).status,'OUT_OF_SCOPE');assert.equal(editorialScope(fa).status,'OUT_OF_SCOPE');
 assert.equal(editorialScope('اجتماع البرلمان بشأن الموازنة').status,'UNCERTAIN_SCOPE');
 assert.equal(editorialScope('أعلنت فرنسا توقيع اتفاق للتعاون').status,'UNCERTAIN_SCOPE');
 assert.equal(editorialScope('https://example.com/إيران @طهران').status,'UNCERTAIN_SCOPE');
 const arLong='أعلنت الحكومة الفرنسية عن افتتاح المدرسة الجديدة';assert.equal(sourceLanguage(arLong),'ar');assert.equal(editorialScope(arLong).status,'UNCERTAIN_SCOPE');
 assert.equal(sourceLanguage('امروز مردم کشور برای افتتاح مدرسه تازه در فرانسه جمع شدند'),'fa');
 assert.ok(coverageInstructions.includes('sports'));
 const effective=groqRuleContext('understand',ruleSet).policy!.find(r=>r.id==='FILTER')!.instruction;
 assert.ok(!effective.includes('Exclude unrelated, ads, sports'));
 assert.ok(effective.includes('all')||effective.includes('any genuine news'));
 assert.ok(effective.includes('incitement without independent news value'));
});
test('Jenin and mixed content diagnose independently without mutating text',()=>{
 const text='مصادر فلسطينية: قوات الاحتلال تقتحم بلدة الزيادية جنوب جنين';assert.equal(sourceLanguage(text),'ar');
 assert.equal(detectSourceLanguage('أعلنت الحكومة عن افتتاح المدرسة الجديدة.\nمردم شهر امروز برای افتتاح مدرسه تازه جمع شدند.'),'mixed');
});
for(const code of ['GEMINI_HTTP_429','GEMINI_HTTP_503','GEMINI_TRANSPORT_FAILED','PROVIDER_REQUEST_LIMIT','GROQ_REQUEST_LIMIT','WORKER_INTERRUPTED'])test(`finite recovery policy ${code}`,()=>{
 assert.equal(failurePolicy(code,1).retryable,true);assert.equal(failurePolicy(code,1).delayMs,30000);
 assert.equal(failurePolicy(code,5).delayMs,480000);assert.ok(failurePolicy(code,999).delayMs<=3600000);
 assert.equal(failurePolicy(code,1).recovery,'BOUNDED_RETRY_THEN_MANUAL_RECOVERY');
});
test('provider signal respected, strict deterministic failures do not open provider circuit',()=>{
 assert.equal(retryAfter(new Headers({'retry-after':'90'})),90000);
 assert.equal(retryAfter(new Headers({'retry-after':'nonsense'})),0);
 assert.equal(failurePolicy('GEMINI_HTTP_429',1,90000).delayMs,90000);
 for(const code of ['AMBIGUOUS_EVIDENCE_CONTEXT','SPEAKER_ATTRIBUTION_MISMATCH','UNSUPPORTED_OUTPUT','UNCERTAIN_SCOPE']){
  const p=failurePolicy(code,1);assert.equal(p.retryable,false);assert.equal(p.providerFailure,false);
 }
 const worker=readFileSync('src/worker/production.ts','utf8');assert.ok(!worker.includes('pause(300000'));assert.ok(!worker.includes('providerAdmissionDelay(db)'));assert.ok(worker.includes('guardedTransport(db'));
});
test('cost/input limits fail closed without the superseded hourly gate',()=>{
 const now=1e9;assert.equal(budgetDecision([],1000,now).allowed,true);
 const hour=Array.from({length:60},()=>({at:now,usd:0.001}));assert.equal(budgetDecision(hour,1000,now).allowed,true);
 assert.equal(budgetDecision([{at:now,usd:1}],1000,now).allowed,false);
 assert.equal(budgetDecision([],limits.requestBytes+1,now).allowed,false);
 assert.equal(budgetDecision([{at:now-86400001,usd:1}],1000,now).allowed,true);
});
test('definite HTTP failure can retry while successful substeps and unknown outcomes cannot be charged again',async()=>{
 const values=new Map<string,{pending:true}|{output:unknown}>();
 const failures:string[]=[];
 const store:CheckpointStore={load:async k=>values.get(k)??null,start:async k=>{values.set(k,{pending:true});},finish:async(k,o)=>{values.set(k,{output:o});},fail:async(k,c,s)=>{failures.push(c);if(s)values.delete(k);}};
 let calls=0;
 await assert.rejects(checkpointCall(store,'one',async()=>{calls++;throw new ProcessingError('GEMINI_HTTP_429');}),/429/);
 assert.equal(await checkpointCall(store,'one',async()=>{calls++;return 'safe';}),'safe');
 assert.equal(await checkpointCall(store,'one',async()=>{throw Error('must not run');}),'safe');assert.equal(calls,2);
 await assert.rejects(checkpointCall(store,'two',async()=>{throw new ProcessingError('GEMINI_TRANSPORT_FAILED');}),/TRANSPORT/);
 await assert.rejects(checkpointCall(store,'two',async()=>{throw Error('must not run');}),/OUTCOME_REQUIRES_REVIEW/);
 assert.deepEqual(failures,['GEMINI_HTTP_429','GEMINI_TRANSPORT_FAILED']);
});
const span=(s:string,t:string)=>({excerpt:t,start:s.indexOf(t),end:s.indexOf(t)+t.length});
test('quoted name plus source-stated role can govern bullets; changed voice and narrative cannot',()=>{
 const heading='«نام نمونه»، تحلیل‌گر و مشاور پیشین:',claim='این تصمیم برای مردم مهم است.';
 const source=`${heading}\n🔹${claim}`;validateSpeakerEvidence(source,span(source,claim),span(source,'نام نمونه'));
 for(const middle of ['\nرئیس گفت: نظر دیگری دارد.\n','\nاین گزارش درباره نام نمونه است.\n']){
  const bad=`${heading}${middle}🔹${claim}`;assert.throws(()=>validateSpeakerEvidence(bad,span(bad,claim),span(bad,'نام نمونه')),/SPEAKER_ATTRIBUTION_MISMATCH/);
 }
 const bad=`در مورد «نام نمونه»، تحلیل‌گر:\n🔹${claim}`;assert.throws(()=>validateSpeakerEvidence(bad,span(bad,claim),span(bad,'نام نمونه')),/SPEAKER_ATTRIBUTION_MISMATCH/);
});
test('repeated or nonverbatim context remains blocked; no arbitrary first occurrence',()=>{
 assert.throws(()=>resolveContextEvidence({excerpt:'تهران',context:'تهران و تهران'},'تهران و تهران'),/AMBIGUOUS/);
 assert.throws(()=>resolveContextEvidence({excerpt:'خبر',context:'خبر مختلف'},'خبر أصلي'),/AMBIGUOUS/);
 const e={excerpt:'تهران',context:'سفر به تهران'};resolveContextEvidence(e,'تهران: سفر به تهران');assert.equal((e as typeof e&{start:number}).start,14);
});
