import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL;
test('local HTTP login/logout, role boundaries and forged session rejection',{skip:!base},async()=>{
 assert.equal(new URL(base!).hostname,'127.0.0.1');
 const get=(path:string,cookie='')=>fetch(base+path,{redirect:'manual',headers:{cookie}});
 const blocked=await get('/');assert.equal(blocked.status,307);assert.equal(new URL(blocked.headers.get('location')!,base).pathname,'/login');
 assert.equal((await get('/review','iran-dashboard-session='+'a'.repeat(64))).status,307);
 async function signIn(username:string,password:string){const html=await (await get('/login')).text();const form=new FormData();for(const [tag] of html.matchAll(/<input\b[^>]*>/g)){if(!tag.includes('type="hidden"'))continue;const name=tag.match(/name="([^"]*)"/)?.[1];if(name)form.set(name,(tag.match(/value="([^"]*)"/)?.[1]??'').replaceAll('&quot;','"').replaceAll('&amp;','&'));}assert([...form.keys()].length>0);form.set('username',username);form.set('password',password);return fetch(base+'/login',{method:'POST',redirect:'manual',headers:{origin:base!},body:form});}
 const bad=await signIn('editor_test','wrong');assert(!bad.headers.get('set-cookie'));
 const editor=await signIn('editor_test','offline dashboard test 123!');assert.equal(editor.status,303);const cookie=editor.headers.get('set-cookie')!.split(';')[0];assert(editor.headers.get('set-cookie')!.includes('HttpOnly'));assert(editor.headers.get('set-cookie')!.includes('SameSite=strict'));
 for(const path of ['/','/review','/approvals','/published'])assert.equal((await get(path,cookie)).status,200,path);
 for(const path of ['/sources','/settings','/logs','/events','/filtered','/system'])assert.equal((await get(path,cookie)).status,403,path);
 const html=await (await get('/',cookie)).text();const logout=[...html.matchAll(/<form[\s\S]*?<\/form>/g)].map(x=>x[0]).find(x=>x.includes('تسجيل الخروج'));assert(logout);const key=logout.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];assert(key);const form=new FormData();form.set(key,'');await fetch(base+'/',{method:'POST',redirect:'manual',headers:{cookie,origin:base!},body:form});assert.equal((await get('/review',cookie)).status,307);
 const admin=await signIn('admin_test','offline dashboard test 123!');assert.equal(admin.status,303);const ac=admin.headers.get('set-cookie')!.split(';')[0];for(const path of ['/sources','/settings','/system','/logs'])assert.equal((await get(path,ac)).status,200,path);
});
