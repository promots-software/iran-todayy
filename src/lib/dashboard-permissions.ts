export type Role='ADMIN'|'EDITOR';
export function allowed(role:Role,path:string){return role==='ADMIN'||['/','/approvals','/review','/published'].includes(path)||/^\/(news|posts|media)\/[^/]+$/.test(path);}
export function assertRole(role:Role,admin=false){if(admin&&role!=='ADMIN')throw new Error('FORBIDDEN');}
