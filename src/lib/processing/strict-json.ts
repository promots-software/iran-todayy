import {ProcessingError} from './contracts';
/** JSON.parse silently keeps the last duplicate key. Reject it before keyed
 * results can hide a conflicting or extra provider selection. */
export function parseProviderJson(text:string):unknown{
 const result:unknown=JSON.parse(text);let at=0;
 const whitespace=()=>{while(at<text.length&&/\s/.test(text[at]))at++;};
 const string=()=>{const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')break;}return JSON.parse(text.slice(start,at)) as string;};
 function value(){whitespace();if(text[at]==='{'){at++;whitespace();const keys=new Set<string>();while(text[at]!=='}'){const key=string();if(keys.has(key))throw new ProcessingError('DUPLICATE_PROVIDER_KEY');keys.add(key);whitespace();at++;value();whitespace();if(text[at]!==',')break;at++;whitespace();}at++;}
 else if(text[at]==='['){at++;whitespace();while(text[at]!==']'){value();whitespace();if(text[at]!==',')break;at++;}at++;}
 else if(text[at]==='"')string();else{while(at<text.length&&!/[\s,\]}]/.test(text[at]))at++;}}
 value();return result;
}
