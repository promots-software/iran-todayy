/** Pure transport formatter; canonical editorial text is never overwritten. */
export const telegramFormatVersion='IRAN_NOW_TELEGRAM_HTML_V1';
const prefix='إيران الآن | ';
const escapeHtml=(s:string)=>s.replace(/&/gu,'&amp;').replace(/</gu,'&lt;').replace(/>/gu,'&gt;');
export type TelegramSnapshot={version:typeof telegramFormatVersion;parseMode:'HTML';headline:string;body:string;text:string;plainText:string};
export function formatTelegram(title:string,body:string):TelegramSnapshot{
 let headline=title.trim();
 while(/^إيران الآن\s*\|\s*/u.test(headline))headline=headline.replace(/^إيران الآن\s*\|\s*/u,'');
 if(!headline||/[\r\n\u0000-\u001f]/u.test(headline))throw new Error('INVALID_TELEGRAM_HEADLINE');
 const comparable=(s:string)=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
 const cleanBody=!body.trim()||comparable(body)===comparable(headline)||comparable(body)===comparable(prefix+headline)?'':body;
 const plainText=prefix+headline+(cleanBody?'\n\n'+cleanBody:'');
 // Conservative UTF-16 count (Telegram entities also use UTF-16 offsets).
 if(plainText.length>4096)throw new Error('TELEGRAM_TEXT_TOO_LONG');
 return {version:telegramFormatVersion,parseMode:'HTML',headline:prefix+headline,body:cleanBody,plainText,text:'<b>'+escapeHtml(prefix+headline)+'</b>'+(cleanBody?'\n\n'+escapeHtml(cleanBody):'')};
}
export function readTelegramSnapshot(value:unknown):TelegramSnapshot|null{
 if(value===null||value===undefined)return null; // Legacy approvals remain plain text.
 if(typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_TELEGRAM_SNAPSHOT');
 const v=value as TelegramSnapshot;
 if(v.version!==telegramFormatVersion||v.parseMode!=='HTML'||typeof v.headline!=='string'||typeof v.body!=='string')throw new Error('INVALID_TELEGRAM_SNAPSHOT');
 const expected=formatTelegram(v.headline,v.body);
 if(v.text!==expected.text||v.plainText!==expected.plainText||v.headline!==expected.headline||v.body!==expected.body)throw new Error('TELEGRAM_SNAPSHOT_CHANGED');
 return expected;
}
