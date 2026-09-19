import {requireUser} from '@/lib/session';
import {db} from '@/lib/db';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){await requireUser();const {id}=await params;const image=await db.publicationImage.findUnique({where:{id}});if(!image)return new Response(null,{status:404});return new Response(image.bytes,{headers:{'Content-Type':image.mime,'Content-Disposition':'inline; filename="publication-image"','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox"}});}
