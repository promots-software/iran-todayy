import test from 'node:test';
import assert from 'node:assert/strict';
import {guidelineFindings} from '../src/lib/processing/guideline-checks';
import {monthLabelConvention,validateMonthRendering} from '../src/lib/processing/newsroom-format';
import {iranNowStyleInstructions} from '../src/lib/processing/iran-now-style';
test('urgent source label is not an instruction; protected literal urgency remains untouched',()=>{assert.equal(guidelineFindings('إيران الآن | عاجل | افتتح المجلس مدرسة','').length,1);assert.deepEqual(guidelineFindings('قال المجلس','قال: «عاجل | القرار»',['«عاجل | القرار»']),[]);});
test('transport markup, emoji and hashtags require review rather than silent source changes',()=>{assert.equal(guidelineFindings('خبر','<b>نص</b> #خبر 🔴').length,3);assert.deepEqual(guidelineFindings('خبر','نص واضح'),[]);});
test('calendar safety wins over unsafe same-day month substitution',()=>{assert.equal(monthLabelConvention('26 شهریور'),'26 شهریور');assert.throws(()=>validateMonthRendering('26 شهریور','26 أيلول'),/MATERIAL_DATE_MISMATCH/);assert.doesNotThrow(()=>validateMonthRendering('26 شهریور','26 أيلول بالتقويم الإيراني'));});
test('generation guidance preserves attribution/legal distinctions/video constraints and no extra routine call',()=>{for(const word of ['judicial judgments','uncertainty','Video copy','Sports copy','Never automatically add عاجل','complete source','no rounding','Semantic safety overrides'])assert(iranNowStyleInstructions.includes(word),word);});
