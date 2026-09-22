import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editoriallyFiltered,selectionBlocksDraft} from '../src/lib/processing/direct-policy';
import {validateDirectExtraction,adaptDirectExtraction,directArabicInstructions} from '../src/lib/processing/direct';
import {bilingualInstructions} from '../src/lib/processing/direct-bilingual';
import {IRAN_NOW_STYLE_PROFILE_V1,iranNowStyleInstructions} from '../src/lib/processing/iran-now-style';
import {editorialDecision} from '../src/lib/processing/editorial-eligibility';
const source='افتتح المجلس مدرسة جديدة في العاصمة.';
const e=(excerpt:string)=>({excerpt,context:source});
const u=()=>adaptDirectExtraction(validateDirectExtraction({actors:[e('المجلس')],action:e('افتتح'),object:e('مدرسة جديدة'),location:e('العاصمة'),event_time:null,statements:[{evidence:e(source),speaker:null,kind:'FACT',material:false}],safety:{filterReason:'NONE',priority:'P2',sensitiveActor:false,leaderDeath:false,seriousClaim:false,rankUnverified:false}},source),source);
test('DIRECT ignores editorial selection labels; NORMAL preserves every existing gate',()=>{
 for(const filterReason of ['UNRELATED','ADVERTISING','SATIRE','RUMOUR','OPINION','INCITEMENT'] as const){
  const value={...u(),filterReason};assert.equal(editoriallyFiltered(value,false,'DIRECT'),false);assert.equal(editoriallyFiltered(value,false,'NORMAL'),true);
 }
 const value={...u(),relevance:'IRRELEVANT' as const,priority:'P4' as const};
 assert.equal(selectionBlocksDraft(value,'DIRECT'),false);assert.equal(selectionBlocksDraft(value,'NORMAL'),true);
});
test('clean candidate ready with safe publishing flags, errors/review/human override never auto-send',()=>{
 const flags={autoPublish:false,shadowMode:true,requireApproval:true};
 assert.equal(editorialDecision({validated:true,review:[]},flags).editorialEligibility,'READY_TO_PUBLISH');
 for(const input of [{validated:true},{validated:true,humanOverride:true},{error:'UNSUPPORTED_OUTPUT'},{validated:true,review:[{code:'UNCERTAIN_MATCH'}]}])assert.equal(editorialDecision(input,flags).deliveryDecision,'HOLD');
 assert.equal(editorialDecision({validated:true,humanOverride:true},{autoPublish:true,shadowMode:false,requireApproval:false}).deliveryDecision,'HOLD');
});
test('versioned style goes only to DIRECT generation, not NORMAL instructions',()=>{
 assert.equal(IRAN_NOW_STYLE_PROFILE_V1.corpus.pairedSourceGold,0);
 assert.ok(directArabicInstructions.includes(iranNowStyleInstructions));assert.ok(bilingualInstructions.includes(iranNowStyleInstructions));
 assert.ok(iranNowStyleInstructions.includes('byte-for-byte'));
 assert.ok(iranNowStyleInstructions.includes('never fabricate a body'));
 assert.ok(iranNowStyleInstructions.includes('Style never overrides semantic safety'));
 assert.ok(!readFileSync('src/lib/processing/gemini-benchmark-prompt.ts','utf8').includes('iranNowStyleInstructions'));
});

for(const mode of ['NORMAL','DIRECT'] as const)for(const autoPublish of [false,true])test(mode+' publishing routing: '+(autoPublish?'AUTO_PUBLISH':'REQUIRE_APPROVAL'),()=>{
 const decision=editorialDecision({validated:true,review:[]},{autoPublish,shadowMode:true,requireApproval:true});
 assert.equal(decision.editorialEligibility,'READY_TO_PUBLISH');assert.equal(decision.deliveryDecision,'HOLD','editorial readiness cannot bypass the independent delivery guards');
 const unsafe=editorialDecision({validated:true,review:[{code:'UNSUPPORTED_OUTPUT'}]},{autoPublish,shadowMode:false,requireApproval:false});assert.equal(unsafe.editorialEligibility,'NEEDS_REVIEW');assert.equal(unsafe.deliveryDecision,'HOLD');
});
