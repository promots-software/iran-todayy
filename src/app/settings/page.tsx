import {AutoPublishPanel} from '@/components/auto-publish-panel';
import {roleLabel} from '@/lib/dashboard-permissions';
import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';

import {UserForm} from '@/components/user-form';
import {PageTitle,DatabaseNotice} from '@/components/ui';
export default async function SettingsPage(){const actor=await requireUser(true);const result=await readDatabase(async()=>({heartbeat:await db.workerHeartbeat.findUnique({where:{id:'telegram-publisher-worker'}}),settings:await db.appSettings.findUnique({where:{id:1}}),users:await db.dashboardUser.findMany({select:{id:true,username:true,displayName:true,role:true,enabled:true},orderBy:{createdAt:'asc'}})}));return <><PageTitle title="الإعدادات" description="طريقة النشر وإدارة حسابات غرفة الأخبار"/>{!result.available?<DatabaseNotice/>:<>{actor.role==='SUPER_ADMIN'?<AutoPublishPanel controls settings={result.data.settings} heartbeat={result.data.heartbeat}/>:<p>التحكم بالنشر التلقائي متاح للمدير الأعلى.</p>}<h2>إدارة المستخدمين</h2><details className="panel"><summary>+ إضافة مستخدم</summary><UserForm superAdmin={actor.role==='SUPER_ADMIN'}/></details>{result.data.users.map(user=><details className="panel" key={user.id}><summary>{user.displayName} · <bdi>{user.username}</bdi> · {roleLabel(user.role)} · {user.enabled?'نشط':'غير نشط'}</summary>{actor.role==='SUPER_ADMIN'||user.role!=='SUPER_ADMIN'?<UserForm user={user} superAdmin={actor.role==='SUPER_ADMIN'}/>:<p>إدارة هذا الحساب متاحة للمدير الأعلى فقط.</p>}</details>)}</>}</>;}
