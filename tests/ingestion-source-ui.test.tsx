import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {IngestionSource} from '../src/components/ingestion-source';
import {NewsCard} from '../src/components/news-card';
const post={source:{name:'وكالة أصلية',handle:'original_feed',platform:'TELEGRAM'},sourceUrl:'https://t.me/original_feed/42'};
for(const status of ['READY_TO_PUBLISH','NEEDS_REVIEW','PUBLISHED','PENDING_APPROVAL','DUPLICATE','FAILED','APPROVED'])test(status+' always shows stored ingestion name, handle, platform and original URL',()=>{
 const html=renderToStaticMarkup(<NewsCard title="تصريح من وكالة أخرى" source={<IngestionSource posts={[post]}/>} time={new Date()} status={status}/>);
 for(const text of ['وكالة أصلية','@original_feed','Telegram',post.sourceUrl,'noopener noreferrer'])assert(html.includes(text));
 assert(html.includes('تصريح من وكالة أخرى'));
});
for(const sourceUrl of [null,'','javascript:alert(1)','https://evil.invalid/post','https://user:password@t.me/a/1'])test('no invented/unsafe URL: '+sourceUrl,()=>{
 const html=renderToStaticMarkup(<IngestionSource posts={[{...post,sourceUrl}]}/>);assert(!html.includes('href='));assert(html.includes('@original_feed'));
});
test('all major query/render surfaces use the shared stored-source component',()=>{
 for(const p of ['src/app/published/page.tsx','src/app/events/page.tsx','src/app/filtered/page.tsx','src/app/news/[id]/page.tsx','src/app/posts/[id]/page.tsx','src/components/news-feed.tsx','src/components/post-feed.tsx','src/components/human-editorial-panel.tsx'])assert(readFileSync(p,'utf8').includes('IngestionSource'),p);
});
test('one radio group and Save; server session and DB role checks; user management remains admin-only',()=>{
 const ui=readFileSync('src/components/publishing-mode-form.tsx','utf8');assert.equal((ui.match(/type="radio" name="value"/g)??[]).length,2);assert(ui.includes('حفظ الإعدادات'));assert(ui.includes('required'));
 const page=readFileSync('src/app/settings/page.tsx','utf8');assert(page.includes('await requireUser()'));assert(page.includes('users:admin?'));assert(page.includes('{admin&&'));
 const action=readFileSync('src/app/operations/actions.ts','utf8');assert(action.includes('await requireUser()'));assert(action.includes('operate(db,user.id'));
 const backend=readFileSync('src/lib/operations-controls.ts','utf8');assert(backend.includes("input.kind==='AUTO_PUBLISH'"));assert(backend.includes('else assertSuperAdmin(actor.role)'));
});
