/** FLASH is a complete title with an empty body. Only Unicode composition and
 * whitespace are ignored for duplicate detection: never words or punctuation.
 * Frozen historical snapshots must never be passed through this renderer. */
export function publicationParts(title:string,body:string){
 const comparable=(text:string)=>text.normalize('NFC').replace(/\s+/gu,' ').trim();
 return {title,body:!body.trim()||comparable(title)===comparable(body)?'':body};
}
export function renderPublicationText(title:string,body:string){
 const parts=publicationParts(title,body);
 return parts.body?`${parts.title}\n\n${parts.body}`:parts.title;
}
