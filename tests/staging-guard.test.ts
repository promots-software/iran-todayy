import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStagingDestination} from '../src/lib/telegram/staging-guard';
test('staging accepts only the verified destination',()=>{assert.doesNotThrow(()=>assertStagingDestination({IRAN_TODAY_ENVIRONMENT:'staging',TELEGRAM_CHAT_ID:'-1004436536617'}));for(const chat of [undefined,'','-1004297263933','-100123'])assert.throws(()=>assertStagingDestination({IRAN_TODAY_ENVIRONMENT:'staging',TELEGRAM_CHAT_ID:chat}),/STAGING_DESTINATION_REJECTED/);});
test('production behavior is untouched',()=>{assert.doesNotThrow(()=>assertStagingDestination({TELEGRAM_CHAT_ID:'-1004297263933'}));});
