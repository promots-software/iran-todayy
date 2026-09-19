import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReviewNotes} from '../src/components/review-notes';
test('review notes consolidate repeated editor-facing reasons without hiding distinct concerns',()=>{
 const html=renderToStaticMarkup(<ReviewNotes reasons={[{code:'EDITORIAL_ATTESTATION_REQUIRED',detail:'titles'},{code:'EDITORIAL_ATTESTATION_REQUIRED',detail:'spelling'},{code:'UNSUPPORTED_OUTPUT'}]}/>);
 assert.equal((html.match(/<li>/g)??[]).length,2);
 assert(html.includes('ملاحظات المراجعة'));
 assert.equal(renderToStaticMarkup(<ReviewNotes reasons={[]}/>),'');
});
