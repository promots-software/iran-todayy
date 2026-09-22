import test from 'node:test';
import assert from 'node:assert/strict';
import {operationErrorMessage} from '../src/lib/operation-errors';
test('operation errors explain safe blockers without reflecting internal messages',()=>{
 for(const code of ['STALE_CONTROL','REQUEST_ID_REUSED','FORBIDDEN','AUTOMATIC_ENABLE_BLOCKED','AUTOMATIC_AUTHORIZATION_REQUIRED','AUTOMATIC_DISABLE_BLOCKED','DELIVERY_RECONCILIATION_REQUIRED']){const message=operationErrorMessage(new Error(code));assert(message);assert(!message.includes(code));assert.notEqual(message,operationErrorMessage(null));}
 assert.equal(operationErrorMessage(new Error('private-token-and-payload')),operationErrorMessage(null));
});
