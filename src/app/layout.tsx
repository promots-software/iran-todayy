import type {Metadata} from 'next';
import {Noto_Sans_Arabic} from 'next/font/google';
import {DashboardShell} from '@/components/dashboard-shell';
import {currentUser} from '@/lib/session';
import './globals.css';
const font=Noto_Sans_Arabic({subsets:['arabic','latin'],display:'swap',variable:'--font-arabic'});
export const metadata:Metadata={title:{default:'منصة إيران الآن',template:'%s | منصة إيران الآن'},robots:{index:false,follow:false}};
export const dynamic='force-dynamic';
export default async function RootLayout({children}:{children:React.ReactNode}){
 const user=await currentUser();
 return <html lang="ar" dir="rtl" className={font.variable} suppressHydrationWarning><body><DashboardShell user={user?{displayName:user.displayName,role:user.role}:null}>{children}</DashboardShell></body></html>;
}
