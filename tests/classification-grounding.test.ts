import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInstitutionGrounding,validateTopicGrounding,validateNoCountryAddition,classificationGroundingInstructions} from '../src/lib/processing/classification-grounding';
import {requireArabic} from '../src/lib/processing/groq-validation';
test('ambiguous institutions stay generic and unidentified',()=>{
 assert.doesNotThrow(()=>validateInstitutionGrounding('Parliament','البرلمان',null));
 assert.throws(()=>validateInstitutionGrounding('Parliament','مجلس الشورى الإسلامي','institution'),/IDENTITY_INFERRED/);
 assert.throws(()=>validateInstitutionGrounding('Government','الحكومة الإيرانية',null),/IDENTITY_INFERRED/);
});
test('explicit Iranian Parliament supports Iran classification without inferred identity',()=>{
 const source=['The Iranian Parliament debated legislation.'];
 assert.doesNotThrow(()=>validateTopicGrounding('IRAN_DOMESTIC','Iranian',source));
 assert.doesNotThrow(()=>validateInstitutionGrounding('Iranian Parliament','البرلمان الإيراني','institution'));
 assert.doesNotThrow(()=>validateNoCountryAddition('البرلمان الإيراني',source));
});
test('English source still requires Arabic rationale',()=>{
 assert.throws(()=>requireArabic('The country is not specified.'),/NON_ARABIC_OUTPUT/);
 assert.doesNotThrow(()=>requireArabic('خبر تشريعي لا يحدد الدولة أو هوية البرلمان.'));
 assert.ok(classificationGroundingInstructions.includes('rationale must be Arabic'));
});
test('unsupported country topic or invented evidence is rejected, UNKNOWN accepted',()=>{
 const source=['Parliament debated legislation.'];
 assert.throws(()=>validateTopicGrounding('IRAN_DOMESTIC',null,source),/ENTITY_UNSUPPORTED/);
 assert.throws(()=>validateTopicGrounding('IRAN_DOMESTIC','Iran',source),/EVIDENCE_INVALID/);
 assert.throws(()=>validateNoCountryAddition('خبر عن إيران',source),/ENTITY_UNSUPPORTED/);
 assert.doesNotThrow(()=>validateTopicGrounding('UNKNOWN',null,source));
});
test('other supported entity classification requires literal evidence too',()=>{
 assert.doesNotThrow(()=>validateTopicGrounding('ISRAEL','Israel',['Officials in Israel met.']));
 assert.throws(()=>validateTopicGrounding('ISRAEL','Officials',['Officials met.']),/ENTITY_UNSUPPORTED/);
});
