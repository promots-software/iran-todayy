import test from 'node:test';
import assert from 'node:assert/strict';
import type {PrismaClient} from '@prisma/client';
import {guardedTransport} from '../src/worker/provider-guard';
import {providerFailureDiagnostic} from '../src/worker/provider-diagnostics';

test('safe diagnostics retain Prisma identity without credential-bearing message/meta/stack',()=>{
 const e=Object.assign(new Error('Transaction already closed: SECRET database URI'),{name:'PrismaClientKnownRequestError',code:'P2028',meta:{secret:'SECRET'}});
 const d=providerFailureDiagnostic(e);assert.equal(d.errorCode,'P2028');assert.equal(d.errorReason,'TRANSACTION_EXPIRED_OR_CLOSED');assert(!JSON.stringify(d).includes('SECRET'));
 assert.equal(providerFailureDiagnostic({name:'SECRET',code:'SECRET',message:'SECRET'}).errorType,'UnknownError');
});
for(const point of ['acquire','lock','clock','count','summary'])test('pre-provider '+point+' failure retains original error, zero dispatch and fail-closed checkpoint',async()=>{
 const original=Object.assign(new Error('Transaction already closed SECRET'),{name:'PrismaClientKnownRequestError',code:'P2028'});
 const logs:string[]=[],writes:{action:string;metadata:{code?:string;replaySafe?:boolean}}[]=[];let transactions=0,queries=0,http=0;
 const auditLog={findFirst:async()=>null,create:async({data}:{data:typeof writes[number]})=>{writes.push(data);return {id:'reservation'};},count:async()=>{if(point==='count')throw original;return 0;}};
 const db={auditLog,$transaction:async(call:(tx:unknown)=>Promise<unknown>)=>{
  transactions++;if(transactions===1)return call({auditLog,$queryRaw:async()=>[]});
  if(point==='acquire')throw original;
  const tx={auditLog,$queryRaw:async()=>{queries++;if((point==='lock'&&queries===1)||(point==='clock'&&queries===2)||(point==='summary'&&queries===3))throw original;if(queries===2)return [{now:new Date()}];return [];}};
  return call(tx);
 }} as unknown as PrismaClient;
 const saved=console.error;console.error=(value:unknown)=>logs.push(String(value));
 try{await assert.rejects(()=>guardedTransport(db,'offline',async()=>{http++;return Response.json({});})('https://example.invalid/request',{body:JSON.stringify({generationConfig:{maxOutputTokens:4096}})}),e=>e===original);}finally{console.error=saved;}
 assert.equal(http,0);assert.equal(logs.length,1);assert(!logs[0].includes('SECRET'));
 const d=JSON.parse(logs[0]);assert.equal(d.errorCode,'P2028');assert.equal(d.networkAttempt,false);
 const expected:Record<string,string>={acquire:'reservation_transaction_acquire',lock:'reservation_advisory_lock',clock:'reservation_clock',count:'reservation_attempt_count',summary:'reservation_budget_summary'};assert.equal(d.phase,expected[point]);
 const failed=writes.find(w=>w.action==='WORKER_PROVIDER_STAGE_FAILED');assert.equal(failed?.metadata.code,'WORKER_INTERRUPTED');assert.equal(failed?.metadata.replaySafe,false);
});

test('completed checkpoint returns unchanged without network or diagnostic writes',async()=>{
 const expected={candidates:[],usageMetadata:{promptTokenCount:1}};let http=0;
 const db={auditLog:{findFirst:async()=>({metadata:{output:expected}})}} as unknown as PrismaClient;
 const result=await guardedTransport(db,'offline',async()=>{http++;throw Error('must not dispatch');})('https://example.invalid/request',{body:'{}'});
 assert.deepEqual(await result.json(),expected);assert.equal(result.headers.get('x-worker-checkpoint-replayed'),'true');assert.equal(http,0);
});
