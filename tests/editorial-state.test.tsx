import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {EditorialState} from '../src/components/editorial-state';
test('editor sees distinct ready, review, technical and filtered Arabic states',()=>{
 const render=(status:string,value:unknown,error?:string)=>renderToStaticMarkup(<EditorialState status={status} value={value} error={error}/>);
 const ready=render('PENDING_APPROVAL',{editorialEligibility:'READY_TO_PUBLISH',deliveryDecision:'HOLD',review:[]});
 assert.match(ready,/جاهز للنشر/);assert.match(ready,/النشر التلقائي معطّل/);assert.ok(!ready.includes('يحتاج مراجعة'));
 const review=render('NEEDS_REVIEW',{review:[{code:'SPEAKER_ATTRIBUTION_MISMATCH'}]});
 assert.match(review,/نسبة التصريح إلى المتحدث غير مؤكدة/);assert.ok(!review.includes('SPEAKER_ATTRIBUTION_MISMATCH'));
 const failure=render('NEEDS_REVIEW',{},'GEMINI_HTTP_503');assert.match(failure,/خطأ في المعالجة/);assert.ok(!failure.includes('GEMINI_HTTP_503'));
 assert.match(render('FILTERED',{}),/مرفوض \/ غير مناسب للنشر/);
 assert.match(render('NEEDS_REVIEW',{review:[{code:'FUTURE_REASON'}]}),/يتطلب الخبر مراجعة تحريرية إضافية/);
});
