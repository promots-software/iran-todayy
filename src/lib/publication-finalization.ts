/** Apply to new editable text BEFORE approval/provenance is frozen. Never use
 * to reinterpret a historical frozen snapshot or change a protected quote. */
export function finalizeBodyPunctuation(body:string){
 const text=body.trimEnd();
 if(!text.trim()||/[.؟!?…][»”"')\]]*$/u.test(text))return text;
 // Closing quote characters stay untouched; an outer sentence stop does not
 // change the literal quotation, including its internal punctuation.
 return text.replace(/[،؛:]$/u,'')+'.';
}
