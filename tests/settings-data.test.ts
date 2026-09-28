import test from 'node:test';import assert from 'node:assert/strict';import type {PrismaClient} from '@prisma/client';import {settingsData} from '../src/lib/settings-data';
test('Settings starts independent reads concurrently but waits for authoritative heartbeat',async()=>{
 const started:string[]=[];let release!:(v:null)=>void;const heartbeat=new Promise<null>(r=>{release=r});
 const db={workerHeartbeat:{findUnique:()=>{started.push('heartbeat');return heartbeat}},appSettings:{findUnique:async()=>{started.push('settings');return {id:1}}},dashboardUser:{findMany:async()=>{started.push('users');return []}}} as unknown as PrismaClient;
 let done=false;const pending=settingsData(db,true).then(v=>{done=true;return v});await Promise.resolve();assert.deepEqual(started,['heartbeat','settings','users']);assert.equal(done,false);release(null);const result=await pending;assert.equal(result.heartbeat,null);assert.deepEqual(result.settings,{id:1});
});
test('Settings retains permissions and propagates failed readiness reads',async()=>{
 let users=0;const db={workerHeartbeat:{findUnique:async()=>null},appSettings:{findUnique:async()=>null},dashboardUser:{findMany:async()=>{users++;return []}}} as unknown as PrismaClient;
 assert.deepEqual(await settingsData(db,false),{heartbeat:null,settings:null,users:[]});assert.equal(users,0);
 const broken={...db,workerHeartbeat:{findUnique:async()=>{throw Error('UNAVAILABLE')}}} as unknown as PrismaClient;
 await assert.rejects(settingsData(broken,false),/UNAVAILABLE/);
});
