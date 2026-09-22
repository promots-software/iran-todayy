/** Presentation-only checks. Findings require review; never rewrite protected facts. */
export function guidelineFindings(title:string,body:string,protectedTexts:readonly string[]=[]){
 let copy=title+'\n'+body;
 for(const literal of [...protectedTexts].filter(Boolean).sort((a,b)=>b.length-a.length))copy=copy.split(literal).join(' ');
 const reasons:string[]=[];
 if(/^(?:إيران الآن\s*\|\s*)?(?:عاجل|خبر عاجل|Breaking)\s*(?:[|:：،—-]|$)/iu.test(copy.trim()))reasons.push('صيغة عاجل تحتاج طلباً تحريرياً صريحاً؛ وجودها في المصدر ليس إذناً بالنشر العاجل');
 if(/\p{Extended_Pictographic}/u.test(copy))reasons.push('رموز تعبيرية خارج الاقتباس؛ ليست جزءاً من صيغة النشر الافتراضية');
 if(/(?:^|\s)#[\p{L}\p{N}_]+/u.test(copy))reasons.push('وسم غير مطلوب في صيغة النشر الافتراضية');
 if(/<(?:b|i|strong|a|script|iframe)\b[^>]*>/iu.test(copy))reasons.push('وسوم عرض داخل النص التحريري؛ تنسيق Telegram منفصل');
 return reasons;
}
