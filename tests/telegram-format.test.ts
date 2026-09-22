import test from 'node:test';
import assert from 'node:assert/strict';
import {formatTelegram,readTelegramSnapshot} from '../src/lib/telegram/format';
import {transportApprovalDigest} from '../src/lib/telegram/format-digest';
import {sendTelegramOnce} from '../src/lib/telegram/publisher';

test('headline bold, exactly one blank line, body normal and paragraphs preserved',()=>{
 const f=formatTelegram('عنوان الخبر','الفقرة الأولى.\n\nالفقرة الثانية.');
 assert.equal(f.text,'<b>إيران الآن | عنوان الخبر</b>\n\nالفقرة الأولى.\n\nالفقرة الثانية.');
 assert.equal((f.text.match(/<b>/g)??[]).length,1);
});
test('FLASH requires no artificial body and identical content is not repeated',()=>{
 assert.equal(formatTelegram('خبر قصير','').text,'<b>إيران الآن | خبر قصير</b>');
 assert.equal(formatTelegram('إيران الآن | خبر قصير','خبر قصير').body,'');
});
test('one branding prefix even for historically repeated heading prefix',()=>{
 assert.equal(formatTelegram('إيران الآن | إيران الآن | خبر','').headline,'إيران الآن | خبر');
});
test('Arabic punctuation, quotes and special characters remain text, never markup',()=>{
 const f=formatTelegram('قال: «أ < ب & ج»','</b><b>محتوى</b>\n"نص"، هل؟ _ * [ ]');
 assert.equal(f.text,'<b>إيران الآن | قال: «أ &lt; ب &amp; ج»</b>\n\n&lt;/b&gt;&lt;b&gt;محتوى&lt;/b&gt;\n"نص"، هل؟ _ * [ ]');
});
test('length guard counts displayed text and never truncates',()=>{
 assert.equal(formatTelegram('ع'.repeat(4096-'إيران الآن | '.length),'').plainText.length,4096);
 assert.throws(()=>formatTelegram('ع'.repeat(4097),''),/TOO_LONG/);
 assert.throws(()=>formatTelegram('عنوان\nآخر',''),/HEADLINE/);
});
test('frozen formatting is validated and its digest binds markup, content and destination',()=>{
 const f=formatTelegram('خبر','نص');const digest=transportApprovalDigest('base','-1001',f);
 assert.deepEqual(readTelegramSnapshot(f),f);
 assert.throws(()=>readTelegramSnapshot({...f,text:f.text+'!'}),/CHANGED/);
 assert.notEqual(digest,transportApprovalDigest('base','-1002',f));
 assert.notEqual(digest,transportApprovalDigest('base','-1001',null));
 assert.notEqual(digest,transportApprovalDigest('base','-1001',formatTelegram('خبر آخر','نص')));
});
test('mock transport sends frozen HTML once and legacy approvals stay plain',async()=>{
 const requests:Record<string,unknown>[]=[];
 const transport:typeof fetch=async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));return Response.json({ok:true,result:{message_id:1,chat:{id:-1001}}});};
 const f=formatTelegram('خبر','نص');
 await sendTelegramOnce({token:'offline',chatId:'-1001'},'خبر\n\nنص',transport,f);
 assert.equal(requests.length,1);assert.equal(requests[0].text,f.text);assert.equal(requests[0].parse_mode,'HTML');
 await sendTelegramOnce({token:'offline',chatId:'-1001'},'النص القديم',transport);
 assert.equal(requests[1].text,'النص القديم');assert.equal(requests[1].parse_mode,undefined);
});
