import test from 'node:test';
import assert from 'node:assert/strict';
import {publisherDelay,idleClaimMs} from '../src/worker/database-cadence';
test('idle polling remains bounded below queue SLO; active delivery stays fast',()=>{
 assert.equal(idleClaimMs,3000);
 for(const status of ['DISABLED','PAUSED','NO_ELIGIBLE_STORY'])assert.equal(publisherDelay(status,0),15000);
 for(const status of ['SENT','IN_FLIGHT','UNKNOWN','ERROR'])assert.equal(publisherDelay(status,0),5000);
});
test('database outage backs off to a minute and healthy cycle resets immediately',()=>{
 assert.deepEqual([1,2,3,4,100].map(n=>publisherDelay('ERROR',n)),[10000,20000,40000,60000,60000]);
 assert.equal(publisherDelay('SENT',0),5000);
});
