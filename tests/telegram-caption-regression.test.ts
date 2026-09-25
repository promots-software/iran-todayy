import test from 'node:test';
import assert from 'node:assert/strict';
import {Api,type TelegramClient} from 'teleproto';
import {TelegramReader,TelegramMonitor} from '../src/lib/telegram/monitor';

// Actual teleproto TL objects, not Bot API caption fields. All network methods
// are mocked; original formatting, entities and media never rewrite .message.
const caption='📌 قالت الهيئة: بدأ العمل.\n\u200b\nإیسنا #خبر\nhttps://example.test/info';
const peer=new Api.PeerChannel({channelId:1n as never});
const photo=()=>new Api.MessageMediaPhoto({photo:new Api.PhotoEmpty({id:1n as never})});
const document=()=>new Api.MessageMediaDocument({document:new Api.DocumentEmpty({id:2n as never})});
const video=()=>new Api.MessageMediaDocument({document:new Api.Document({id:3n as never,accessHash:0n as never,fileReference:Buffer.alloc(0),date:1700000000,mimeType:'video/mp4',size:0n as never,dcId:1,attributes:[new Api.DocumentAttributeVideo({duration:1,w:16,h:16})]})});
for(const [name,media] of [['text',undefined],['photo',photo()],['document',document()],['video',video()]] as const)test(`teleproto ${name}: caption/message preserved through collector`,async()=>{
 const message=new Api.Message({id:101,peerId:peer,date:1700000000,message:caption,media});
 const reader=new TelegramReader({getMessages:async()=>[message]} as unknown as TelegramClient);
 const normalized=await reader.messages('testchannel',100);
 assert.equal(normalized[0].text,caption);
 const monitor=new TelegramMonitor({channel:async()=> '1',messages:async()=>normalized});
 const page=await monitor.poll({handle:'testchannel',cursor:{kind:'telegram-shadow-v1',channelId:'1',lastId:100}},new AbortController().signal);
 assert.equal(page.posts[0].content,caption);assert.equal(page.posts[0].metadata.messageKind,'TEXT');
});
test('album caption on a later member is captured exactly once without merging message IDs',async()=>{
 const raw=['',caption,''].map((message,i)=>new Api.Message({id:101+i,peerId:peer,date:1700000000,message,media:photo(),groupedId:999n as never}));
 const reader=new TelegramReader({getMessages:async()=>raw} as unknown as TelegramClient);
 const monitor=new TelegramMonitor({channel:async()=> '1',messages:(...args)=>reader.messages(...args)});
 const page=await monitor.poll({handle:'testchannel',cursor:{kind:'telegram-shadow-v1',channelId:'1',lastId:100}},new AbortController().signal);
 assert.deepEqual(page.posts.map(p=>p.externalId),['101','102','103']);
 assert.equal(page.posts.filter(p=>p.content===caption).length,1);
 assert.equal(page.posts.filter(p=>p.metadata.messageKind==='MEDIA_ONLY').length,2);
 assert.equal(page.cursor.lastId,103);
});
test('media with no caption produces no invented source text',async()=>{
 const message=new Api.Message({id:101,peerId:peer,date:1700000000,message:'',media:photo()});
 const reader=new TelegramReader({getMessages:async()=>[message]} as unknown as TelegramClient);
 const [result]=await reader.messages('testchannel',100);
 assert.equal(result.text,'');assert.equal(result.hasPhoto,true);
});
test('forward and edited caption still use actual message text, never metadata',async()=>{
 const message=new Api.Message({id:101,peerId:peer,date:1700000000,message:caption,media:document(),editDate:1700000010,fwdFrom:new Api.MessageFwdHeader({date:1699999990,fromName:'Original channel'}),entities:[new Api.MessageEntityBold({offset:0,length:2})]});
 const reader=new TelegramReader({getMessages:async()=>[message]} as unknown as TelegramClient);
 assert.equal((await reader.messages('testchannel',100))[0].text,caption);
});
