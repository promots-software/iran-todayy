import 'server-only';
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {db} from './db';
import {sessionCookie,sessionUser,assertRole} from './dashboard-auth';
import {assertSuperAdmin} from './dashboard-permissions';
export async function currentUser(){return sessionUser(db,(await cookies()).get(sessionCookie)?.value);}
export async function requireUser(admin=false){const user=await currentUser();if(!user)redirect('/login');assertRole(user.role,admin);return user;}
export async function requireSuperAdmin(){const user=await requireUser();assertSuperAdmin(user.role);return user;}
