import 'server-only';
import {cache} from 'react';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {db} from './db';
import {sessionCookie,sessionUser,assertRole} from './dashboard-auth';
import {allowed,assertSuperAdmin} from './dashboard-permissions';
// React cache is scoped to this server render, never shared between requests.
// Layout and page authorization reuse one lookup without caching policy or users globally.
export const currentUser=cache(async()=>sessionUser(db,(await cookies()).get(sessionCookie)?.value));
export async function requireUser(admin=false){const user=await currentUser();if(!user)redirect('/login');assertRole(user.role,admin);return user;}
export async function requireSuperAdmin(){const user=await requireUser();assertSuperAdmin(user.role);return user;}

/** Page access uses the same policy as the proxy and sidebar; action guards remain separate. */
export async function requirePageAccess(path:string){const user=await requireUser();if(!allowed(user.role,path))throw new Error('FORBIDDEN');return user;}
