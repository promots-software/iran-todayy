import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationParts,renderPublicationText} from '../src/lib/publication-text';
import {humanText} from '../src/lib/human-editorial-contract';
import {publicationText,sendTelegramOnce} from '../src/lib/telegram/publisher';

const title='إيران الآن | أعلن المتحدث انتهاء الاجتماع.';
test('FLASH title-only and duplicate title/body have one canonical publication',()=>{
 for(const body of ['',title,`  ${title.replaceAll(' ','\u00a0')}\n`]){
  assert.equal(publicationParts(title,body).body,'');
  assert.equal(renderPublicationText(title,body),title);
  assert.equal(humanText({title,body}),title);
  assert.equal(publicationText({title,arabicContent:body}),title);
 }
});
test('distinct non-FLASH prose and punctuation differences are preserved',()=>{
 const body='وقال إن البيان سيصدر لاحقاً.';
 assert.equal(humanText({title,body}),`${title}\n\n${body}`);
 assert.equal(publicationText({title,arabicContent:body}),`${title}\n\n${body}`);
 assert.equal(publicationParts(title,title.slice(0,-1)).body,title.slice(0,-1));
 assert.throws(()=>humanText({title:'',body:title}));
 assert.throws(()=>humanText({title,body:'English only'}));
 assert.throws(()=>humanText({title,body:'\u0000'}));
});
test('Telegram transport receives exactly the single canonical FLASH copy',async()=>{
 let calls=0;
 await sendTelegramOnce({token:'123:offline',chatId:'-100123'},humanText({title,body:title}),async(_url,init)=>{
  calls++;assert.equal(JSON.parse(String(init?.body)).text,title);
  return Response.json({ok:true,result:{message_id:1,chat:{id:-100123}}});
 });assert.equal(calls,1);
});
test('legacy frozen duplicate differs from current text and must be reapproved',()=>{
 const frozen=`${title}\n\n${title}`;
 assert.notEqual(humanText({title,body:title}),frozen);
 assert.equal(frozen,`${title}\n\n${title}`); // Historical snapshots are not rewritten.
});
