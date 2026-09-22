export type Role='SUPER_ADMIN'|'ADMIN'|'EDITOR';
export const roleLabel=(role:Role)=>({SUPER_ADMIN:'المدير الأعلى',ADMIN:'مدير',EDITOR:'محرر'})[role];
export const isAdministrator=(role:Role)=>role==='ADMIN'||role==='SUPER_ADMIN';
export function allowed(role:Role,path:string){if(/^\/operations(?:\/|$)/.test(path))return role==='SUPER_ADMIN';return isAdministrator(role)||['/','/approvals','/review','/published','/settings'].includes(path)||/^\/(news|posts|media)\/[^/]+$/.test(path);}
export function assertRole(role:Role,admin=false){if(admin&&!isAdministrator(role))throw new Error('FORBIDDEN');}
export function assertSuperAdmin(role:Role){if(role!=='SUPER_ADMIN')throw new Error('FORBIDDEN');}
/** ADMIN may manage existing ordinary roles, never promote or edit a SUPER_ADMIN. */
export function assertUserManagement(actor:Role,next:Role,previous?:Role){assertRole(actor,true);if(actor!=='SUPER_ADMIN'&&(next==='SUPER_ADMIN'||previous==='SUPER_ADMIN'))throw new Error('FORBIDDEN');}
