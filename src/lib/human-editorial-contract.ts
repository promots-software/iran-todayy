import {createHash} from 'node:crypto';
import type {HumanEditorialDraft,Prisma} from '@prisma/client';
import {ProcessingError} from './processing/contracts';
import {renderPublicationText} from './publication-text';
/** Serializes edits, approvals and send claims, including the legacy AI path. */
export async function lockEditorialPublication(tx:Prisma.TransactionClient){
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(184209, 1)::text`;
}
export function humanText(d:Pick<HumanEditorialDraft,'title'|'body'>){
 const text=renderPublicationText(d.title,d.body);
 if(!d.title.trim()||text.length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(d.title+d.body))throw new ProcessingError('INVALID_HUMAN_DRAFT');
 if(!/\p{Script=Arabic}/u.test(d.title)||(d.body.trim()&&!/\p{Script=Arabic}/u.test(d.body)))throw new ProcessingError('ARABIC_HUMAN_DRAFT_REQUIRED');
 return text;
}
export function humanDigest(d:Pick<HumanEditorialDraft,'id'|'title'|'body'|'revision'|'originalSnapshot'> & {publicationImageId?:string|null;mediaDecisionAt?:Date|null}){
 return createHash('sha256').update(JSON.stringify(['HUMAN_EDITED',d.id,d.revision,d.title,d.body,d.originalSnapshot,...(d.publicationImageId||d.mediaDecisionAt?[d.publicationImageId??null,d.mediaDecisionAt?.toISOString()??null]:[])])).digest('hex');
}

/** New frozen approvals bind content to a destination; legacy records stay immutable. */
export function humanPublicationDigest(d:Parameters<typeof humanDigest>[0],destination:string){
 return createHash('sha256').update(JSON.stringify(['HUMAN_DESTINATION_V1',humanDigest(d),destination])).digest('hex');
}
export function matchesHumanPublication(d:Parameters<typeof humanDigest>[0],p:{idempotencyKey:string;destination:string}){
 return p.idempotencyKey===humanPublicationDigest(d,p.destination)||p.idempotencyKey===humanDigest(d);
}
