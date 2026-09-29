import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient,Prisma} from '@prisma/client';
import {operationsPosts} from '../src/lib/operations-posts';

test('Operations projection preserves JSON types, null fallback, boundaries and counters without result blobs',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 assert.equal(new URL(process.env.TEST_DATABASE_URL!).hostname,'127.0.0.1');
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const from=new Date('2026-01-01T00:00:00Z'),to=new Date('2026-01-02T00:00:00Z');
 try{
 const source=await db.source.create({data:{name:'offline projection',platform:'TELEGRAM',handle:'offline-projection',url:'https://example.invalid'}});
 const variants=[null,{}, {processingMode:null},{processingMode:false},{processingMode:0},{processingMode:''},{processingMode:'OTHER'},{processingMode:'NORMAL'},{processingMode:'DIRECT',classification:'MATERIAL_UPDATE'},[],{processingMode:['DIRECT']}];
 for(let i=0;i<variants.length;i++)await db.sourcePost.create({data:{sourceId:source.id,sourcePostId:String(i),sourceUrl:'https://example.invalid/offline',originalContent:'offline',sourcePublishedAt:from,ingestedAt:i===0?from:i===1?to:new Date(+from+1000),processingResult:variants[i]===null?Prisma.JsonNull:variants[i] as Prisma.InputJsonValue,relevanceResult:{processingMode:'DIRECT',unused:'x'.repeat(20000)}}});
 await db.sourcePost.create({data:{sourceId:source.id,sourcePostId:'outside',sourceUrl:'https://example.invalid/offline',originalContent:'offline',sourcePublishedAt:from,ingestedAt:new Date(+to+1)}});
 const old=await db.sourcePost.findMany({where:{ingestedAt:{gte:from,lte:to}},select:{sourceId:true,status:true,processingResult:true,relevanceResult:true}});
 const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
 const expected=old.map(p=>({sourceId:p.sourceId,status:p.status,processingMode:record(p.processingResult).processingMode??null,relevanceMode:record(p.relevanceResult).processingMode??null,classification:record(p.processingResult).classification??null}));
 const actual=await operationsPosts(db,from,to);
 const sort=(v:unknown[])=>v.map(x=>JSON.stringify(x)).sort();
 assert.deepEqual(sort(actual),sort(expected));assert.equal(actual.length,variants.length);
 assert(Buffer.byteLength(JSON.stringify(actual))<Buffer.byteLength(JSON.stringify(old))/20);
 assert.equal(actual.filter(p=>p.classification==='MATERIAL_UPDATE').length,1);
 }finally{await db.$disconnect();}
});
