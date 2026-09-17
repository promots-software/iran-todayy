import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRationaleGrounding,validateNoCountryAddition,normalizeInstitutionIdentity} from '../src/lib/processing/classification-grounding';
test('explicit evidence denial is allowed across entities but positive assertions are rejected',()=>{
 for(const entity of ['إيراني','إسرائيلي','أوروبا','الصين']){
  assert.doesNotThrow(()=>validateRationaleGrounding(`لم يثبت ارتباطها بسياق ${entity}.`,[]));
  assert.doesNotThrow(()=>validateRationaleGrounding(`لا يوجد دليل على سياق ${entity}.`,[]));
  assert.throws(()=>validateRationaleGrounding(`ثبت ارتباطها بسياق ${entity}.`,[]),/ENTITY_UNSUPPORTED/);
  assert.throws(()=>validateRationaleGrounding(`لم يثبت ارتباطها بسياق ${entity}، لكن الخبر مرتبط بسياق ${entity}.`,[]),/ENTITY_UNSUPPORTED/);
 }
});
test('negation outside explicit evidence denial is not a grounding exemption',()=>{
 assert.throws(()=>validateRationaleGrounding('لم تجتمع الحكومة في الصين.',[]),/ENTITY_UNSUPPORTED/);
 assert.throws(()=>validateNoCountryAddition('لم يثبت ارتباطها بسياق إيراني.',[]),/ENTITY_UNSUPPORTED/);
});
test('generic English and Arabic institutions normalize identity without changing evidence or generic wording',()=>{
 for(const term of ['Parliament','البرلمان']){
  const result=normalizeInstitutionIdentity(term,{key:'INVENTED_NATIONAL_ID',arabic:'البرلمان',nameKind:'institution'});
  assert.deepEqual(result,{key:'PARLIAMENT',arabic:'البرلمان',nameKind:null});
 }
 assert.throws(()=>normalizeInstitutionIdentity('Parliament',{key:'X',arabic:'مجلس الشورى الإسلامي',nameKind:'institution'}),/IDENTITY_INFERRED/);
 const named={key:'EXPLICIT',arabic:'البرلمان الإيراني',nameKind:'institution'};
 assert.deepEqual(normalizeInstitutionIdentity('Iranian Parliament',named),named);
});
