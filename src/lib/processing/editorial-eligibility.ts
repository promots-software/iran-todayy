import {isProviderWait} from "./failure-policy";
/** Editorial quality and permission to deliver are independent. No send occurs here. */
export type EditorialEligibility = 'READY_TO_PUBLISH'|'NEEDS_REVIEW'|'FILTERED'|'PROCESSING_ERROR';
export const editorialLabels:Record<EditorialEligibility,string>={READY_TO_PUBLISH:'جاهز للنشر',NEEDS_REVIEW:'يحتاج مراجعة',FILTERED:'مرفوض / غير مناسب للنشر',PROCESSING_ERROR:'خطأ في المعالجة'};
export const arabicReasons:Record<string,string>={
 SOURCE_TEXT_REQUIRED:'المنشور بلا نص؛ يلزم محتوى مكتوب قبل إعداد خبر للنشر',
 UNCERTAIN_SCOPE:'لم تثبت صلة جغرافية واضحة بنطاق التغطية',
 CLASSIFICATION_ENTITY_UNSUPPORTED:'التصنيف يتضمن جهة أو نطاقاً غير مثبت في الأدلة',
 ARABIC_RENDERING_ENTITY_UNSUPPORTED:'الصياغة العربية تضيف جهة أو دولة غير مثبتة في الدليل',
 SPEAKER_ATTRIBUTION_MISMATCH:'نسبة التصريح إلى المتحدث غير مؤكدة',
 SPEAKER_ATTRIBUTION_REQUIRED:'تعذّر تحديد صاحب التصريح بشكل موثوق',
 SPEAKER_TRANSLATION_UNVERIFIED:'تعريب هوية المتحدث غير مثبت بالأدلة',
 AMBIGUOUS_EVIDENCE_CONTEXT:'سياق المعلومة في المصدر غير واضح بما يكفي لاعتماد الصياغة',
 INVALID_EVIDENCE:'نص الدليل لا يطابق المصدر', EVIDENCE_CONTEXT_REQUIRED:'يلزم سياق واضح للدليل من المصدر',
 UNSUPPORTED_OUTPUT:'تتضمن الصياغة العربية معلومة غير مدعومة بوضوح من المصدر',
 SOURCE_LANGUAGE_UNCERTAIN:'تعذّر تحديد لغة المصدر بشكل موثوق',SOURCE_LANGUAGE_MISMATCH:'لغة المصدر المحفوظة لا تطابق النص',
 INCOMPLETE_EXTRACTION:'تعذّر استخراج المعلومات الأساسية من الخبر بشكل كامل',
 NUMBER_MISMATCH:'يوجد رقم في الصياغة لا يطابق المصدر',ARABIC_RENDERING_NUMBER_MISMATCH:'يوجد رقم في الصياغة لا يطابق المصدر',
 IDENTITY_AMBIGUOUS:'هوية أحد الأشخاص المذكورين غير واضحة',UNKNOWN_NAME:'تعريب اسم أو هويته غير مثبتين بالأدلة',
 SPEAKER_AMBIGUOUS:'تعذّر تحديد صاحب التصريح بشكل موثوق',
 ATTRIBUTION_LOST:'الصياغة لا تحافظ بوضوح على نسبة الادعاء إلى مصدره',
 UNCERTAINTY_LOST:'المصدر يعرض المعلومة كغير مؤكدة بينما الصياغة تعرضها كحقيقة',
 QUOTE_INTEGRITY_FAILURE:'الاقتباس في الصياغة لا يطابق المصدر بشكل موثوق',QUOTE_REVIEW:'الاقتباس في الصياغة لا يطابق المصدر بشكل موثوق',
 MATERIAL_DATE_MISMATCH:'التاريخ الوارد في الصياغة لا يطابق المصدر',MATERIAL_NAME_MISMATCH:'اسم مهم في الصياغة لا يطابق المصدر بشكل موثوق',
 MATERIAL_FACT_OMISSION:'الصياغة أغفلت معلومة أساسية تؤثر في معنى الخبر',
 VALIDATED_ARABIC_RENDERING_REQUIRED:'لم تثبت سلامة الصياغة العربية مقابل أدلة المصدر',UNVALIDATED_ARABIC_RENDERING:'الصياغة العربية غير مطابقة لمعنى أدلة المصدر',NON_ARABIC_OUTPUT:'الصياغة ليست عربية سليمة',
 UNVERIFIED_SOURCE:'لم توثق هوية المصدر أو تصنيفه',FLAGGED_SOURCE:'المصدر معلّم ويحتاج إلى تدقيق',
 SERIOUS_CLAIM:'نسبة الادعاء الخطير إلى صاحبه لم تثبت بالكامل',RANK_UNVERIFIED:'الرتبة أو المنصب غير مثبتين في الأدلة',
 UNCOVERED_TERM:'يوجد مصطلح لم يُحسم معناه أو تعريبه',CONTEXT_REQUIRED:'سياق الخبر أو المصطلح يحتاج إلى توضيح',
 EDITORIAL_ATTESTATION_REQUIRED:'يلزم تدقيق تحريري لم يُثبت آلياً',FIGURE_CONFLICT:'توجد أرقام متعارضة بين المصادر',
 FORMAT_REVIEW:'صيغة أو تحويل تاريخ أو وحدة يحتاج إلى تدقيق',UNCERTAIN_MATCH:'تعذّر حسم التطابق مع خبر سابق',
 SINGLE_UNOFFICIAL_FIGURE:'أرقام غير محسومة من مصدر واحد غير رسمي',LEADER_STATUS:'وفاة شخصية قيادية أو هويتها تحتاج إلى تدقيق',SENSITIVE_ACTOR:'هوية الجهة أو سياقها الحساس يحتاج إلى تدقيق',
 ARCHIVE_ONLY:'مادة أرشيفية غير مخصصة للنشر',HUMAN_APPROVAL_REQUIRED:'النسخة البشرية تنتظر موافقة صريحة من المحرر',
};
export const technicalExplanation='تعذّرت معالجة الخبر بسبب خطأ تقني، وسيحتاج إلى إعادة المحاولة';
const operational=new Set(['SHADOW_MODE_REVIEW','AUTO_PUBLISH_DISABLED','REQUIRE_APPROVAL','MANUAL_PUBLICATION_REQUIRED']);
export function isTechnicalFailure(code:string){
 if(isProviderWait(code)||code==='SOURCE_PROCESSING_MODE_CHANGED')return true;
 return /(?:SCHEMA|INVALID_JSON|INVALID_RESPONSE|INVALID_ID_CLASSIFICATION|TRANSPORT|HTTP_|UNAVAILABLE|REQUEST_LIMIT|INPUT_LIMIT|RATE_LIMIT|INTERRUPTED|TIMEOUT|LEASE_|STALE_CLAIM|AUTH_FAILED|API_KEY|PROCESSING_FAILED|REQUEST_REJECTED|REQUEST_TOO_LARGE|REFUSAL|^(?:GEMINI|GROQ|OPENAI)_INCOMPLETE$)/u.test(code);
}
export type ReasonInput={code:string;detail?:string};
export function reviewMessages(reasons:ReasonInput[]){
 const priority=(code:string)=>/UNSUPPORTED|NUMBER|DATE|QUOTE|FACT_OMISSION/u.test(code)?0:/SPEAKER|ATTRIBUTION|IDENTITY/u.test(code)?1:2;
 const messages=reasons.filter(r=>!operational.has(r.code)).sort((a,b)=>priority(a.code)-priority(b.code)).map(r=>{
  const code=r.code==='UNSUPPORTED_OUTPUT'&&r.detail&&/^[A-Z][A-Z_0-9]+$/u.test(r.detail)?r.detail:r.code;
  if(isTechnicalFailure(code))return technicalExplanation;
  const label=arabicReasons[code]??'يتطلب الخبر مراجعة تحريرية إضافية';
  const safeDetail=['UNKNOWN_NAME','UNCOVERED_TERM','RANK_UNVERIFIED'].includes(code)&&r.detail&&r.detail.length<=160&&/^[\p{Script=Arabic}\p{M}\p{N}\s،.()\-]+$/u.test(r.detail)?r.detail:null;
  return safeDetail?`${label}: ${safeDetail}`:label;
 });
 return [...new Set(messages)];
}
export function editorialDecision(input:{filtered?:boolean;error?:string|null;validated?:boolean;review?:ReasonInput[];humanOverride?:boolean},delivery:{autoPublish:boolean;shadowMode:boolean;requireApproval:boolean}){
 const review=(input.review??[]).filter(r=>!operational.has(r.code));
 const editorialEligibility:EditorialEligibility=input.error?(isTechnicalFailure(input.error)?'PROCESSING_ERROR':'NEEDS_REVIEW'):input.filtered?'FILTERED':input.validated&&!review.length&&!input.humanOverride?'READY_TO_PUBLISH':'NEEDS_REVIEW';
 const deliveryDecision=editorialEligibility==='READY_TO_PUBLISH'&&delivery.autoPublish&&!delivery.shadowMode&&!delivery.requireApproval&&!input.humanOverride?'SEND':'HOLD';
 return {editorialEligibility,deliveryDecision,review} as const;
}
export function readEditorialState(value:unknown,status:string,error?:string|null){
 const data=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 // Never relabel historical failed output as ready by merely removing an old flag.
 if(typeof data.editorialEligibility==='string'&&data.editorialEligibility in editorialLabels)return data.editorialEligibility as EditorialEligibility;
 if(error)return isTechnicalFailure(error)?'PROCESSING_ERROR':'NEEDS_REVIEW';
 if(status==='FILTERED'||status==='REJECTED'||status==='DUPLICATE')return 'FILTERED';
 if(status==='PENDING_APPROVAL'&&data.validated===true)return 'READY_TO_PUBLISH';
 return 'NEEDS_REVIEW';
}
