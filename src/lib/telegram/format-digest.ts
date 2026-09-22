import {createHash} from 'node:crypto';
import {readTelegramSnapshot} from './format';
export function transportApprovalDigest(base:string,destination:string,snapshot:unknown){
 const parsed=readTelegramSnapshot(snapshot);
 return parsed?createHash('sha256').update(JSON.stringify(['TELEGRAM_FORMAT_APPROVAL_V1',base,destination,parsed])).digest('hex'):base;
}
