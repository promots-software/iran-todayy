import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {publishOne} from '../src/lib/telegram/publisher';

const env={TELEGRAM_PUBLISH_ENABLED:'true',SHADOW_MODE:'false',TELEGRAM_BOT_TOKEN:'123:offline',TELEGRAM_CHAT_ID:'-100123'};
for(const code of ['P2028','P2002','P1001','private-secret'])test(`claim failure ${code} never invokes transport and logs only safe diagnostics`,async()=>{
 const error=Object.assign(new Error('private connection and story contents'),{code});
 const logs:string[]=[];let sends=0;const saved=console.error;console.error=(line:string)=>{logs.push(line);};
 const db={$transaction:async(_callback:unknown,options:unknown)=>{assert.deepEqual(options,{timeout:30000});throw error;}} as unknown as PrismaClient;
 try{await assert.rejects(publishOne(db,'offline-publication',env,async()=>{sends++;throw Error('must not send');}),e=>e===error);}finally{console.error=saved;}
 assert.equal(sends,0);assert.deepEqual(logs.map(s=>JSON.parse(s)),[{event:'PUBLICATION_CLAIM_FAILED',publicationId:'offline-publication',phase:'BEFORE_TRANSPORT',code:code.startsWith('P')?code:'CLAIM_REJECTED'}]);
 assert(!logs.join('').includes('private'));
});

test('claim transaction survives more than five seconds, without a send or publication mutation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});let sends=0;const saved=console.error;console.error=()=>{};
 const wrapped={$transaction:(callback:Parameters<typeof db.$transaction>[0],options:unknown)=>db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SELECT pg_sleep(5.1)');
  return (callback as unknown as (tx:unknown)=>Promise<unknown>)(tx);
 },options as {timeout:number})} as unknown as PrismaClient;
 try{await assert.rejects(publishOne(wrapped,'missing-offline-publication',env,async()=>{sends++;throw Error('must not send');}),e=>!!e&&typeof e==='object'&&'code' in e&&e.code==='P2025');assert.equal(sends,0);}finally{console.error=saved;await db.$disconnect();}
});
