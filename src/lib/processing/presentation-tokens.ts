/** Structural view only. Never rewrite stored source text or evidence offsets.
 * Deliberately excludes lexical text, digits, quotes, negation and factual symbols.
 * An emoji outside this small visual-marker set remains material/unknown. */
export function presentationOnly(text:string){
 return /^[\s\u200b\u200e\u200f\uFE0E\uFE0F🎥✅⭕🔹🔸🔻🔺▪▫•●◾◽*—–-]*$/u.test(text);
}
