import {AutoPublishPanel} from '@/components/auto-publish-panel';
import {roleLabel,isAdministrator} from '@/lib/dashboard-permissions';
import {requirePageAccess} from '@/lib/session';
import {db} from '@/lib/db';
import {settingsData} from '@/lib/settings-data';
import {readDatabase} from '@/lib/queries';
import {UserForm} from '@/components/user-form';
import {PageTitle,DatabaseNotice} from '@/components/ui';
export default async function SettingsPage(){
 const actor=await requirePageAccess('/settings');const admin=isAdministrator(actor.role);
 const result=await readDatabase(()=>settingsData(db,admin));
 return <><PageTitle title="الإعدادات" description="طريقة النشر وإدارة حسابات غرفة الأخبار"/>{!result.available?<DatabaseNotice/>:<>
 <AutoPublishPanel controls recovery={actor.role==='SUPER_ADMIN'} settings={result.data.settings} heartbeat={result.data.heartbeat}/>
 {admin&&<><h2>إدارة المستخدمين</h2><details className="panel"><summary>+ إضافة مستخدم</summary><UserForm superAdmin={actor.role==='SUPER_ADMIN'}/></details>{result.data.users.map(user=><details className="panel" key={user.id}><summary>{user.displayName} · <bdi>{user.username}</bdi> · {roleLabel(user.role)} · {user.enabled?'نشط':'غير نشط'}</summary>{actor.role==='SUPER_ADMIN'||user.role!=='SUPER_ADMIN'?<UserForm user={user} superAdmin={actor.role==='SUPER_ADMIN'}/>:<p>إدارة هذا الحساب متاحة للمدير الأعلى فقط.</p>}</details>)}</>}
 </>}</>;
}
