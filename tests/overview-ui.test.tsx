import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {OverviewStats} from '../src/components/overview-stats';
import {ThemeToggle} from '../src/components/theme-toggle';

test('Overview has exactly four ordered cards, genuine zero counts, and written labels beside status dots',()=>{
 const html=renderToStaticMarkup(<OverviewStats counts={{sources:7,published:0,duplicates:2,unrelatedRejected:3}}/>);
 const labels=['المصادر','الأخبار المنشورة اليوم','الأخبار المكررة','الأخبار غير المتعلقة بإيران والمرفوضة'];
 assert.equal((html.match(/class="overview-stat[" ]/g)||[]).length,4);
 for(let i=1;i<labels.length;i++)assert(html.indexOf(labels[i])>html.indexOf(labels[i-1]));
 assert.equal((html.match(/overview-indicator green/g)||[]).length,2);assert(html.includes('overview-indicator red'));
 assert(html.includes('overview-stat-grey'));assert(!html.includes('بانتظار المراجعة'));
 assert(html.includes(new Intl.NumberFormat('ar-LB').format(0)));assert(!html.includes('—'));
 const missing=renderToStaticMarkup(<OverviewStats counts={null}/>);assert.equal((missing.match(/—/g)||[]).length,4);
});
test('Shared theme control is icon-only with an accessible next-action name in both modes',()=>{
 for(const dark of [false,true]){const html=renderToStaticMarkup(<ThemeToggle dark={dark} onToggle={()=>{}}/>);
 assert(html.includes('type="button"'));assert(html.includes('<svg'));assert(html.includes('aria-hidden="true"'));
 assert(html.includes('aria-label="تفعيل المظهر '+(dark?'الفاتح':'الداكن')+'"'));
 assert(!html.replace(/<[^>]*>/g,'').trim());assert(!html.includes('disabled'));
 }
});
