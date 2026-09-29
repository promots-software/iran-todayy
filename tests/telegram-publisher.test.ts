import test from 'node:test';
import assert from 'node:assert/strict';
import {sendTelegramOnce,assertSendEnabled,readPublisherEnv,publicationBodyForProvenance} from '../src/lib/telegram/publisher';
const config={token:'123:offline_token',chatId:'-100123'};

test('hashtag suffix cannot conceal unsupported prose from provenance checks',()=>{
 const body='نص مثبت بالدليل';
 assert.equal(publicationBodyForProvenance(body+'\n\n#إيران_الآن #سياسة'),body);
 for(const suffix of ['#إيران_الآن\nادعاء غير مسند','#إيران_الآن ادعاء غير مسند','#إيران_الآن\n\nادعاء غير مسند']){
  assert.ok(publicationBodyForProvenance(body+'\n\n'+suffix).includes('ادعاء غير مسند'));
 }
});
test('sending is disarmed in shadow mode and credentials stay server-side',()=>{
 assert.throws(()=>assertSendEnabled({SHADOW_MODE:'true',TELEGRAM_PUBLISH_ENABLED:'true'}),/DISABLED/);
 assert.throws(()=>assertSendEnabled({SHADOW_MODE:'false'}),/DISABLED/);
 assert.throws(()=>readPublisherEnv({}),/CONFIG_REQUIRED/);
 assert.doesNotThrow(()=>assertSendEnabled({SHADOW_MODE:'false',TELEGRAM_PUBLISH_ENABLED:'true'}));
});
test('one plain-text send, no paid broadcast, validated message ID',async()=>{
 let calls=0;
 const result=await sendTelegramOnce(config,'خبر',async(_url,init)=>{
  calls++;const data=JSON.parse(String(init?.body));assert.equal(data.text,'خبر');assert.equal(data.allow_paid_broadcast,false);assert.equal(data.parse_mode,undefined);
  return Response.json({ok:true,result:{message_id:42,chat:{id:-100123}}});
 });assert.deepEqual(result,{status:'SENT',messageId:'42',chatId:'-100123'});assert.equal(calls,1);
});
test('uncertain delivery never automatically retries or logs provider secrets',async()=>{
 for(const failure of ['timeout','invalid','server','destination']){
  let calls=0;
  const result=await sendTelegramOnce(config,'خبر',async()=>{
   calls++;if(failure==='timeout')throw new Error(config.token);
   if(failure==='invalid')return new Response('invalid');
   if(failure==='destination')return Response.json({ok:true,result:{message_id:1,chat:{id:-999}}});
   return Response.json({ok:false,description:config.token,error_code:500},{status:500});
  });assert.equal(result.status,'UNKNOWN');assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(config.token));
 }
});
test('definite rate-limit rejection is persisted as failed without an automatic retry',async()=>{
 let calls=0;const result=await sendTelegramOnce(config,'خبر',async()=>{calls++;return Response.json({ok:false,error_code:429,parameters:{retry_after:2}},{status:429});});
 assert.equal(result.status,'FAILED');assert.equal(calls,1);
});

test('transport diagnostics are bounded safe metadata and never retry',async()=>{
 for(const failure of ['timeout','parse','response','success']){
  let calls=0;const d:Record<string,unknown>={};
  const result=await sendTelegramOnce(config,'private article',async()=>{calls++;if(failure==='timeout')throw new DOMException('secret URL/token','TimeoutError');if(failure==='parse')return new Response('not json',{status:502});if(failure==='response')return Response.json({ok:true,result:{message_id:7,chat:{id:-999}}});return Response.json({ok:true,result:{message_id:8,chat:{id:-100123}}});},null,d);
  assert.equal(calls,1);assert.equal(d.dispatchBegan,true);assert(!JSON.stringify(d).includes('secret'));assert(!JSON.stringify(d).includes('private article'));assert.equal(result.status,failure==='success'?'SENT':'UNKNOWN');
  if(failure==='timeout'){assert.equal(d.errorCategory,'TIMEOUT');assert.equal(d.httpStatus,null);}
  if(failure==='parse'){assert.equal(d.httpStatus,502);assert.equal(d.parsingBegan,true);assert.equal(d.parsingCompleted,false);}
  if(failure==='response'){assert.equal(d.messageId,'7');assert.equal(d.telegramOk,true);assert.equal(d.errorCategory,'UNEXPECTED_RESPONSE');}
 }
});
