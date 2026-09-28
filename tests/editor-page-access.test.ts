import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {allowed,assertRole,visibleDashboardRoutes} from '../src/lib/dashboard-permissions';
const pages=['/','/sources','/monitoring','/processing','/published','/events','/filtered'];
test('Editor sidebar exposes exactly the seven allowed pages including Duplicates',()=>{
 const routes=visibleDashboardRoutes('EDITOR');
 assert.deepEqual(routes.map(([href])=>href),pages);
 assert.equal(routes.find(([href])=>href==='/events')?.[1],'الأخبار المكررة');
});
test('direct Editor routes match navigation while privileged routes and actions stay denied',()=>{
 for(const path of pages)assert.equal(allowed('EDITOR',path),true,path);
 for(const path of ['/settings','/approvals','/review','/operations','/operations/failures','/logs','/system','/api/users','/events-extra','/news/example','/posts/example','/media/example'])assert.equal(allowed('EDITOR',path),false,path);
 assert.throws(()=>assertRole('EDITOR',true),/FORBIDDEN/);
 assert.equal(allowed('ADMIN','/operations'),false);
 assert.equal(allowed('SUPER_ADMIN','/operations'),true);
});
test('page entry points, sidebar and request proxy consume the central route policy',()=>{
 for(const route of ['sources','monitoring','processing','events','filtered','published','approvals','review','settings','logs','system','operations','operations/failures','operations/posts/[id]','news/[id]','posts/[id]']){
  const page=readFileSync('src/app/'+route+'/page.tsx','utf8');
  assert(page.includes("requirePageAccess('/"+route+"')"));
  assert(!page.includes('requireUser(true)'));
 }
 assert(readFileSync('src/components/dashboard-shell.tsx','utf8').includes('visibleDashboardRoutes(user.role)'));
 assert(readFileSync('src/proxy.ts','utf8').includes('allowed(user.role,path)'));
 assert(readFileSync('src/lib/session.ts','utf8').includes('allowed(user.role,path)'));
});

test('Admin excludes System and Operations; Super Admin retains all dashboard pages',()=>{
 const admin=visibleDashboardRoutes('ADMIN').map(([href])=>href);
 const superAdmin=visibleDashboardRoutes('SUPER_ADMIN').map(([href])=>href);
 assert.equal(superAdmin.length,13);
 assert.deepEqual(admin,superAdmin.filter(p=>p!=='/system'&&p!=='/operations'));
 for(const route of ['/system','/system/nested','/operations','/operations/failures']){assert(!allowed('ADMIN',route));assert(allowed('SUPER_ADMIN',route));}
});
