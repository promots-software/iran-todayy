import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
import {readDatabase} from '@/lib/queries';
import {ModeForm} from '@/components/forms';
import {UserForm} from '@/components/user-form';
import {PageTitle,DatabaseNotice} from '@/components/ui';
export default async function SettingsPage(){await requireUser(true);const result=await readDatabase(async()=>({settings:await db.appSettings.findUnique({where:{id:1}}),users:await db.dashboardUser.findMany({select:{id:true,username:true,displayName:true,role:true,enabled:true},orderBy:{createdAt:'asc'}})}));return <><PageTitle title="الإعدادات" description="طريقة النشر وإدارة حسابات غرفة الأخبار"/>{!result.available?<DatabaseNotice/>:<><ModeForm mode={result.data.settings?.publishingMode??'REQUIRE_APPROVAL'}/><h2>إدارة المستخدمين</h2><UserForm/>{result.data.users.map(user=><UserForm key={user.id} user={user}/>)}</>}</>;}
