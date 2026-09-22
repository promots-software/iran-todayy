'use server';
import {requireSuperAdmin} from '@/lib/session';
import {operationErrorMessage} from '@/lib/operation-errors';
import {db} from '@/lib/db';
import {operate} from '@/lib/operations-controls';
import {revalidatePath} from 'next/cache';
export async function operationAction(_: {ok:boolean;message:string},form:FormData){
 try{const user=await requireSuperAdmin();await operate(db,user.id,{requestId:form.get('requestId'),kind:form.get('kind'),target:form.get('target'),value:form.get('value'),expected:form.get('expected'),confirmed:form.get('confirmed')==='on'});revalidatePath('/operations');revalidatePath('/settings');return {ok:true,message:'حُفظ التغيير التشغيلي في السجل.'};}
 catch(error){return {ok:false,message:operationErrorMessage(error)};}
}
