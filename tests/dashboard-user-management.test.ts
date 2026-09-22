/* eslint-disable @typescript-eslint/no-explicit-any -- Offline doubles execute the actual server action without Next request context or a database. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {hashPassword,verifyPassword} from '../src/lib/dashboard-auth';
import * as permissions from '../src/lib/dashboard-permissions';
import {assertRole} from '../src/lib/dashboard-permissions';
function setup(role:'SUPER_ADMIN'|'ADMIN'|'EDITOR'='ADMIN',old:any=null,duplicate=false){
 const calls:any[]=[];const tx={
  $queryRaw:async()=>[],
  dashboardUser:{findUniqueOrThrow:async({where}:any)=>where.id==='acting-admin'?{id:'acting-admin',role,enabled:true}:old,count:async()=>1,create:async({data}:any)=>{if(duplicate)throw {code:'P2002'};calls.push(['create',data]);return{id:'new-user',...data};},update:async({data}:any)=>{calls.push(['update',data]);return{id:old.id,...data};}},
  dashboardSession:{deleteMany:async(arg:any)=>calls.push(['revoke',arg])},auditLog:{create:async(arg:any)=>calls.push(['audit',arg])},
 };
 const dependencies:any={'@/lib/dashboard-permissions':permissions,'zod':{z},'next/cache':{revalidatePath:(p:string)=>calls.push(['refresh',p])},'@/lib/db':{db:{$transaction:async(fn:any)=>{calls.push(['transaction']);return fn(tx);}}},'@/lib/session':{requireUser:async(admin:boolean)=>{assertRole(role,admin);return{id:'acting-admin',role};}},'@/lib/dashboard-auth':{hashPassword}};
 const exports:any={};const code=ts.transpileModule(readFileSync('src/app/settings/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:(name:string)=>{assert(name in dependencies,name);return dependencies[name];}});
 return{calls,save:(f:FormData)=>exports.manageUserAction({ok:false,message:''},f)};
}
function form(role='EDITOR'){const f=new FormData();for(const [k,v] of Object.entries({id:'',username:'New.Editor',displayName:'محرر الاختبار',role,password:'offline password 123!',enabled:'on'}))f.set(k,v);return f;}
for(const role of ['ADMIN','EDITOR'] as const)test(`ADMIN creates ${role}, hashes password and refreshes users list`,async()=>{const s=setup();const r=await s.save(form(role));assert(r.ok);const data=s.calls.find(c=>c[0]==='create')[1];assert.equal(data.username,'new.editor');assert.equal(data.role,role);assert.equal(data.enabled,true);assert(await verifyPassword('offline password 123!',data.passwordHash));assert.notEqual(data.passwordHash,'offline password 123!');assert(s.calls.some(c=>c[0]==='refresh'&&c[1]==='/settings'));assert.equal(s.calls.find(c=>c[0]==='audit')[1].data.actor,'user:acting-admin');});
test('duplicate username gives explicit Arabic validation and no success',async()=>{const s=setup('ADMIN',null,true);const r=await s.save(form());assert.equal(r.ok,false);assert.equal(r.message,'اسم المستخدم مستخدم بالفعل. اختر اسماً آخر.');assert(!s.calls.some(c=>c[0]==='audit'||c[0]==='refresh'));});
test('EDITOR cannot invoke user creation directly',async()=>{const s=setup('EDITOR');assert.equal((await s.save(form('ADMIN'))).ok,false);assert.equal(s.calls.length,0);});
test('last enabled ADMIN cannot be deactivated or demoted',async()=>{for(const demote of [true,false]){const s=setup('ADMIN',{id:'last',role:'ADMIN',enabled:true});const f=form(demote?'EDITOR':'ADMIN');f.set('id','last');if(!demote)f.delete('enabled');assert.equal((await s.save(f)).ok,false);assert(!s.calls.some(c=>['update','revoke','audit'].includes(c[0])));}});
test('updating/deactivating EDITOR preserves password and revokes sessions',async()=>{const s=setup('ADMIN',{id:'editor',role:'EDITOR',enabled:true});const f=form();f.set('id','editor');f.set('password','');f.delete('enabled');assert((await s.save(f)).ok);const data=s.calls.find(c=>c[0]==='update')[1];assert.equal(data.enabled,false);assert(!('passwordHash'in data));assert(s.calls.some(c=>c[0]==='revoke'));});

test('ADMIN cannot create SUPER_ADMIN or alter its password/role',async()=>{const create=setup('ADMIN');assert.equal((await create.save(form('SUPER_ADMIN'))).ok,false);assert(!create.calls.some(c=>c[0]==='create'));const edit=setup('ADMIN',{id:'super',role:'SUPER_ADMIN',enabled:true});const f=form('ADMIN');f.set('id','super');assert.equal((await edit.save(f)).ok,false);assert(!edit.calls.some(c=>c[0]==='update'));});
test('SUPER_ADMIN may create ordinary administrators using existing password hashing',async()=>{const s=setup('SUPER_ADMIN');assert((await s.save(form('ADMIN'))).ok);assert.equal(s.calls.find(c=>c[0]==='create')[1].role,'ADMIN');});
test('last enabled SUPER_ADMIN cannot be deactivated or demoted',async()=>{for(const role of ['ADMIN','SUPER_ADMIN']){const s=setup('SUPER_ADMIN',{id:'last-super',role:'SUPER_ADMIN',enabled:true});const f=form(role);f.set('id','last-super');if(role==='SUPER_ADMIN')f.delete('enabled');assert.equal((await s.save(f)).ok,false);assert(!s.calls.some(c=>c[0]==='update'));}});
