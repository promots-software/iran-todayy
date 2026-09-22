import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {PrismaClient} from '@prisma/client';
import {changeMode} from '../src/lib/source-service';
test('Settings exposes authoritative Auto-Publish only; legacy server action/form absent',()=>{
 const settings=readFileSync('src/app/settings/page.tsx','utf8');
 assert(settings.includes('<AutoPublishPanel controls'));
 for(const file of ['src/app/settings/page.tsx','src/components/forms.tsx','src/app/actions.ts']){
  const source=readFileSync(file,'utf8');assert(!/ModeForm|modeAction|name="publishingMode"|اعتماد التحرير البشري/.test(source));
 }
});
test('legacy callers cannot change safety configuration or automatic policy',async()=>{
 const db={$transaction:()=>{throw Error('must not write');}} as unknown as PrismaClient;
 for(const mode of ['AUTO_PUBLISH','REQUIRE_APPROVAL',null])await assert.rejects(changeMode(db,mode,'legacy'),/LEGACY_PUBLISHING_MODE_REMOVED/);
});
