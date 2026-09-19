'use client';
import {useActionState} from 'react';
import {loginAction} from './actions';
export default function LoginPage(){const [state,action,pending]=useActionState(loginAction,{message:''});return <main className="login"><section className="panel"><h1>منصة إيران الآن</h1><p className="muted">تسجيل الدخول إلى غرفة الأخبار</p><form action={action}><label>اسم المستخدم<input name="username" autoComplete="username" required maxLength={100}/></label><label>كلمة المرور<input name="password" type="password" autoComplete="current-password" required maxLength={256}/></label><button disabled={pending}>تسجيل الدخول</button><p role="alert">{state.message}</p></form></section></main>;}
