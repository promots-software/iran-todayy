import {propositionReceiptSchema} from './proposition-receipt';
import {createHash} from 'node:crypto';
import {stableJson} from './structural-integrity';
import {ProcessingError} from './contracts';
export function validatePropositionBinding(raw:unknown,source:string,publication:{id:string;text:string}[]){
 const p=propositionReceiptSchema.safeParse(raw),hash=(x:unknown)=>createHash('sha256').update(stableJson(x)).digest('hex');
 if(!p.success||p.data.sourceHash!==hash(source)||p.data.publicationHash!==hash(publication.map(p=>({id:p.id,text:p.text}))))throw new ProcessingError('PROPOSITION_RECEIPT_INVALID');
 return p.data;
}
