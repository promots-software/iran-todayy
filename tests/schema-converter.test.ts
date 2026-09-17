import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {groqSchema} from '../src/lib/processing/groq-context';
type SchemaNode={properties:Record<string,SchemaNode>;items:SchemaNode;enum?:unknown[];type?:string;minLength?:number};

test('schema keywords do not remove same-named fields and required matches transformed properties',()=>{
 const contract=z.object({format:z.enum(['NEWS','BREAKING']),pattern:z.string().min(1),nested:z.object({maximum:z.string(),sourcePostId:z.string()}),rows:z.array(z.object({minLength:z.string()}))});
 const schema=groqSchema('draft',contract) as unknown as SchemaNode;
 assert.deepEqual(schema.properties.format.enum,['NEWS','BREAKING']);
 assert.equal(schema.properties.pattern.type,'string');
 assert.equal(schema.properties.pattern.minLength,undefined);
 assert.equal(schema.properties.nested.properties.maximum.type,'string');
 assert.equal(schema.properties.rows.items.properties.minLength.type,'string');
 assert.equal(schema.properties.nested.properties.sourcePostId,undefined);
 const check=(node:unknown):void=>{
  if(!node||typeof node!=='object')return;
  if('properties' in node && node.properties && typeof node.properties==='object')assert.deepEqual('required' in node?node.required:undefined,Object.keys(node.properties));
  Object.values(node).forEach(check);
 };
 check(schema);check(groqSchema('draft'));
 assert.ok(groqSchema('draft').properties?.format);
 assert.equal(contract.safeParse({format:'NEWS',pattern:'',nested:{maximum:'x',sourcePostId:'p'},rows:[]}).success,false);
});
