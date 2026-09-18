import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegramPoller} from '../src/worker/telegram-poller';
import {probeAuthorization} from '../src/worker/runtime';
test('connection-time auth-key conflict is preserved before authorization and source reads',async()=>{
 let auth=0,reads=0,closed=0;
 const poller=new TelegramPoller(()=>({connected:false,
  connect:()=>probeAuthorization(async()=>{throw {errorMessage:'AUTH_KEY_DUPLICATED',message:'private'};}),
  authorize:async()=>{auth++;},close:async()=>{closed++;},
  channel:async()=>{reads++;return '1';},messages:async()=>[],
 }));
 await assert.rejects(poller.poll({handle:'test_source',cursor:null},new AbortController().signal),/^Error: TELEGRAM_SESSION_CONFLICT$/);
 assert.equal(auth,0);assert.equal(reads,0);assert.equal(closed,1);assert.equal(poller.ready,false);
});
