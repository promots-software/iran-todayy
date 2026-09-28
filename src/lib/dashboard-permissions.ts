export type Role='SUPER_ADMIN'|'ADMIN'|'EDITOR';
export const roleLabel=(role:Role)=>({SUPER_ADMIN:'المدير الأعلى',ADMIN:'مدير',EDITOR:'محرر'})[role];
export const isAdministrator=(role:Role)=>role==='ADMIN'||role==='SUPER_ADMIN';
export const editorDashboardRoutes=['/','/sources','/monitoring','/processing','/published','/events','/filtered'] as const;
export function allowed(role:Role,path:string){if(/^\/(operations|system)(?:\/|$)/.test(path))return role==='SUPER_ADMIN';return isAdministrator(role)||(editorDashboardRoutes as readonly string[]).includes(path);}
export function assertRole(role:Role,admin=false){if(admin&&!isAdministrator(role))throw new Error('FORBIDDEN');}
export function assertSuperAdmin(role:Role){if(role!=='SUPER_ADMIN')throw new Error('FORBIDDEN');}
/** ADMIN may manage existing ordinary roles, never promote or edit a SUPER_ADMIN. */
export function assertUserManagement(actor:Role,next:Role,previous?:Role){assertRole(actor,true);if(actor!=='SUPER_ADMIN'&&(next==='SUPER_ADMIN'||previous==='SUPER_ADMIN'))throw new Error('FORBIDDEN');}

export const dashboardRoutes=[['/','نظرة عامة'],['/sources','المصادر'],['/monitoring','رصد'],['/approvals','الموافقات'],['/review','المراجعات'],['/published','الأخبار المنشورة'],['/filtered','المستبعد والمرفوض'],['/events','الأخبار المكررة'],['/processing','سجل المعالجة'],['/logs','سجل العمليات'],['/settings','الإعدادات'],['/system','حالة النظام'],['/operations','مركز العمليات']];
export const visibleDashboardRoutes=(role:Role)=>role==='EDITOR'
 ?editorDashboardRoutes.map(href=>[href,href==='/monitoring'?'الرصد':dashboardRoutes.find(([route])=>route===href)![1]])
 :dashboardRoutes.filter(([href])=>allowed(role,href));
