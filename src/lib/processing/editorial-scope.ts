/** Coverage evidence is editorial metadata, NEVER a factual identity supplied to
 * extraction. A city match cannot turn an unnamed parliament into an institution. */
export type Geography='IRAN'|'SYRIA'|'LEBANON'|'PALESTINE'|'IRAQ'|'YEMEN';
export type Scope={status:'IN_SCOPE'|'OUT_OF_SCOPE'|'UNCERTAIN_SCOPE';geographies:Geography[];evidence:string[];version:'six-geographies-v1'};
const places:Record<Geography,string[]>={
 // Hormuz borders both Iran and Oman: coverage relevance only, never ownership
 // or institutional identity. EIA World Oil Transit Chokepoints, Hormuz section.
 IRAN:['إيران','ايران','ایران','إيرانية','الإيراني','ایرانی','Iran','Iranian','طهران','تهران','Tehran','اصفهان','أصفهان','شيراز','شیراز','مضيق هرمز','تنگه هرمز','Strait of Hormuz'],
 SYRIA:['سوريا','سورية','السوري','السورية','Syria','Syrian','دمشق','Damascus','حلب','Aleppo','اللاذقية'],
 LEBANON:['لبنان','اللبناني','اللبنانية','Lebanon','Lebanese','بيروت','Beirut','بعلبك','النبطية'],
 PALESTINE:['فلسطين','فلسطينية','الفلسطيني','الفلسطينية','Palestine','Palestinian','جنين','Jenin','رام الله','Ramallah','نابلس','Nablus','غزة','Gaza','قطاع غزة','Gaza Strip'],
 IRAQ:['العراق','عراق','العراقي','العراقية','Iraq','Iraqi','بغداد','Baghdad','البصرة','Basra','الموصل','Mosul'],
 YEMEN:['اليمن','يمن','اليمني','اليمنية','Yemen','Yemeni','صنعاء','Sanaa','عدن','Aden','الحديدة'],
};
const normalize=(s:string)=>s.normalize('NFC').replace(/[\u064b-\u065f\u0670\u0640]/gu,'').toLowerCase();
const clean=(s:string)=>s.replace(/https?:\/\/\S+|[\w.+%-]+@[\w.-]+|@[\p{L}\p{N}_]+/gu,' ');
const contains=(s:string,p:string)=>new RegExp(`(?<![\\p{L}\\p{N}])${normalize(p).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`,'u').test(s);
export function editorialScope(original:string):Scope {
 const text=normalize(clean(original)), evidence:string[]=[],geographies:Geography[]=[];
 for(const [geography,names] of Object.entries(places)){
  const hits=names.filter(p=>contains(text,p));
  if(hits.length){geographies.push(geography as Geography);evidence.push(...hits);}
 }
 if(geographies.length)return {status:'IN_SCOPE',geographies,evidence,version:'six-geographies-v1'};
 // Only explicit, single-location local-event constructions can be rejected
 // early. Mere absence of a covered country (or a foreign dateline) is NOT enough.
 // Diplomacy, cross-border affairs, unnamed participants and multi-paragraph
 // context stay uncertain. Expand this rule only with reviewed evidence/tests.
 const localEvent=/^(?:زلزال|هزة أرضية|فيضانات|تساقط الثلوج|earthquake|snowfall|flooding|زلزله|بارش برف)\s+(?:بقوة\s+[\d.]+\s+)?(?:في|در|in)\s+(?:کشور\s+)?(فرنسا|أستراليا|استرالیا|ألمانيا|آلمان|france|australia|germany)[.!؟\s]*$/iu;
 const status=localEvent.test(text.trim())?'OUT_OF_SCOPE':'UNCERTAIN_SCOPE';
 return {status,geographies,evidence:[],version:'six-geographies-v1'};
}
/** Legacy enum retained for database compatibility: it now means genuine news
 * of any category. This override does not alter factual/editorial PDF rules. */
export const coverageInstructions='NORMAL sources: decide Iran relevance ONCE during extraction. Accept any story related to Iran, including indirect diplomatic, economic, cultural, scientific or regional relationships. Exclude only clearly Iran-unrelated stories (IRRELEVANT). If relevance is uncertain, conservatively ACCEPT (POLITICAL_NEWS); never hold for scope uncertainty. Source nationality, political identity, category, viewpoint and priority cannot exclude an Iran-related story. After acceptance, classification/rendering only check factual integrity; no further relevance or editorial selection gate. Do not infer identities, countries or ownership. Preserve ambiguous source wording conservatively. DIRECT sources are already accepted by the administrator and must not receive a relevance decision.';
