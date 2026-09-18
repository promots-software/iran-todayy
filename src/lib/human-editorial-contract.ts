import {createHash} from 'node:crypto';
import type {HumanEditorialDraft,Prisma} from '@prisma/client';
import {ProcessingError} from './processing/contracts';
/** Serializes edits, approvals and send claims, including the legacy AI path. */
export async function lockEditorialPublication(tx:Prisma.TransactionClient){
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(184209, 1)::text`;
}
export function humanText(d:Pick<HumanEditorialDraft,'title'|'body'>){
 const text=`${d.title}\n\n${d.body}`;
 if(!d.title.trim()||!d.body.trim()||text.length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))throw new ProcessingError('INVALID_HUMAN_DRAFT');
 if(!/\p{Script=Arabic}/u.test(d.title)||!/\p{Script=Arabic}/u.test(d.body))throw new ProcessingError('ARABIC_HUMAN_DRAFT_REQUIRED');
 return text;
}
export function humanDigest(d:Pick<HumanEditorialDraft,'id'|'title'|'body'|'revision'|'originalSnapshot'>){
 return createHash('sha256').update(JSON.stringify(['HUMAN_EDITED',d.id,d.revision,d.title,d.body,d.originalSnapshot])).digest('hex');
}
