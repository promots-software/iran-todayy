import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceLanguage} from '../src/lib/processing/source-language';
test('Arabic and Persian retain existing positive detection',()=>{
 assert.equal(sourceLanguage('قال الوزير إن الاجتماع سيعقد في العاصمة.'),'ar');
 assert.equal(sourceLanguage('او گفته که در جلسه حضور داشته است.'),'fa');
 assert.equal(sourceLanguage('او گفته که در جلسه حضور داشته است. https://example.com/news @channel'),'fa');
});
test('English uses script and multiple distinct grammatical markers, case insensitive',()=>{
 for(const text of ['The council has approved a proposal for debate.','THE MEMBERS WERE NOT INFORMED OF THE DECISION.','Officials said that they will meet on Monday.'])assert.equal(sourceLanguage(text),'en');
});
test('ambiguous and mixed text is held without guessing',()=>{
 for(const text of ['', '12345', 'Budget proposal', 'the the the the','Bonjour tout le monde','The minister قال إن الاجتماع في العاصمة.','او گفته که در جلسه است. The meeting is over.'])assert.equal(sourceLanguage(text),'unknown');
});
test('detection leaves source text unchanged',()=>{
 const original='The council has approved the proposal.\nhttps://example.com/news';const copy=original;
 assert.equal(sourceLanguage(original),'en');assert.equal(original,copy);
});

test('real ISNA Persian headlines and reports are detected as Persian',()=>{
 const samples=[
  '۲۰۰ شب حضور پرشور مردم اراک در تجمع میدانی',
  'رئیس انجمن داروسازان ایران: پیش از اجرای برنامه پزشک خانواده، بدهی داروخانه‌ها پرداخت شود',
  'خانه موزه شهریار در روستای «خوشگناب» افتتاح می‌شود',
  'در دیدار وزیر خارجه ایران و چین چه گذشت؟',
  'رئیس مجلس قانون پشتیبانی و رفع موانع تولید کشاورزی را ابلاغ کرد',
  'مذاکرات وزرای امور خارجه جمهوری اسلامی ایران و چین در پکن',
  'انصارالله یمن: ادعای هدف قرار دادن مکه، دروغی تکراری است',
  'صفحه اول روزنامه‌های چهارشنبه ۲۵ شهریور'
 ];
 for(const text of samples) assert.equal(sourceLanguage(text),'fa',text);
});

test('predominantly Persian reports tolerate limited Latin names and acronyms',()=>{
 const samples=[
  'سرنگونی جنگنده F15 عربستان در یمن. رسانه‌ها اخباری مبنی بر ساقط شدن جنگنده سعودی از نوع F15 در استان مأرب یمن منتشر می‌کنند.',
  'دام برای بدنسازی ایران؟ احتمال حضور ایران در WBPF به جای IFBB. فدراسیون جهانی بدنسازی IFBB تاکنون دعوتنامه تیم ایران را ارسال نکرده است.',
  'جدیدترین گزارش درباره پروتکل مونترال منتشر شد. در مطالعه‌ای در نشریه Nature Communications آمده است که مصرف مواد ODS کاهش نیافت.',
  'سامانه رفاتم بانک رفاه کارگران برای تقویت روابط پایدار میان تولیدکنندگان و تأمین‌کنندگان راه‌اندازی شده است.'
 ];
 for(const text of samples) assert.equal(sourceLanguage(text),'fa',text);
});

test('real Arabic fast-news headlines are detected as Arabic',()=>{
 const samples=[
  'حزام الأسد: هكذا ترتسم اليوم بفضل الله معادلة: الحصار بالحصار، والتصعيد بالتصعيد',
  'مصادر فلسطينية: قوات العدو تعتقل شابًا خلال اقتحام بلدة دير بلوط غرب سلفيت',
  'طائرات الاحتلال تشن غارة تستهدف المنطقة الجنوبية لمدينة خانيونس جنوبي قطاع غزة',
  'كوريا الشمالية تعلن رفضها لقرار اعتمدته الوكالة الدولية للطاقة الذرية ينتقد برنامجها للأسلحة النووية',
  'قصف مدفعي إسرائيلي شرقي مدينة غزة',
  'الطيران الحربي السعودي يستهدف غرب مأرب اليمنية',
  'الجيش السوداني يعلن استعادة منطقتي أبوقعود وأم صميمة بغرب كردفان',
  'وزارة الصحة اللبنانية: استهداف المؤسسات الطبية والكوادر الصحية جريمة حرب مكتملة الأركان وانتهاك صارخ للاتفاقيات الدولية'
 ];
 for(const text of samples) assert.equal(sourceLanguage(text),'ar',text);
});

test('Arabic reports tolerate occasional Persian keyboard forms',()=>{
 const samples=[
  'أكد المتحدث باسم وزارة الخارجية إسماعیل بقائي أن العالم لا ينخدع بالروايات الكاذبة',
  'أفادت إرنا الیوم الجمعة بأن رئيس الجمهورية أشاد باللغة والأدب الفارسي',
  'أكد الوزير في 18 ایلول أن التعاون الاقتصادي سيستمر',
  'القائد العام أكد أن مواصلة الحضور مائتی یوم تعكس إرادة الشعب'
 ];
 for(const text of samples) assert.equal(sourceLanguage(text),'ar',text);
});

test('short real ISNA Persian headlines are detected as Persian',()=>{
 const samples=[
  'امروز طهرون قدیمی‌ها هم جانفدا بودند',
  '۲۰۱ شب حضور مردم اصفهان در میدان',
  'بعثت ۲۰۱؛ اجتماع مردمی بابلسر',
  'بیش از ۲۰۰ شب حماسه حضور؛ بوشهر',
  '۲۰۰ شب تجمع در میدان؛ خراسان شمالی',
  '۲۰۰ شب حضور مردم لرستان در میدان',
  '۲۰۰ شب تجمع در شهرستان ورامین'
 ];
 for(const text of samples) assert.equal(sourceLanguage(text),'fa',text);
});

test('competing prose and names alone do not establish one source language',()=>{
 for(const text of [
  'قال الوزير إن الاجتماع في العاصمة. او گفته که در جلسه حضور داشته است.',
  'قال الوزير إن الاجتماع في العاصمة.\nاو گفته که در جلسه حضور داشته است.',
  'فاطمة عائشة خديجة', 'پژمان کیان گیلان', 'الكتاب دانشگاه',
  '۱۲۳۴۵ ۶۷۸۹ ۲۰۰', 'عاجل!!! 12345', 'در در در در',
  'او گفته که در جلسه حضور داشته است. The government has decided to act.',
 ])assert.equal(sourceLanguage(text),'unknown',text);
});

test('productive grammar generalizes beyond supplied headlines without rewriting evidence',()=>{
 const cases:[string,'ar'|'fa'][]=[
  ['المكتبات البلدية تستقبل الزوار للقراءة الجماعية','ar'],
  ['توسعة مدرسية جديدة بضاحية المدينة','ar'],
  ['بِالْمَدِينَةِ مكتبةٌ جديدةٌ تستقبلُ الأطفالَ','ar'],
  ['کتابخانه‌ها برای خانواده‌ها فردا باز می‌شوند','fa'],
  ['امروز کارگران در خانه بودند','fa'],
  ['أعلنت الوزارة في بیان أن المكتبة ستفتح أبوابها','ar'],
  ['أعلنت الوزارة أن أجهزة GPS تعمل في المدينة.','ar'],
 ];
 for(const [text,language] of cases){const copy=text;assert.equal(sourceLanguage(text),language,text);assert.equal(text,copy);}
});

test('metadata cannot supply linguistic evidence or turn ambiguous text into prose',()=>{
 assert.equal(sourceLanguage('123 @قال_في https://example.com/که/در'),'unknown');
 assert.equal(sourceLanguage('الكتاب دانشگاه https://example.com/the-and'),'unknown');
 assert.equal(sourceLanguage('او گفته که در جلسه حضور داشته است. scf.example.ir'),'fa');
 assert.equal(sourceLanguage('قال الوزير إن الاجتماع في العاصمة. A NEW MEETING'),'unknown');
});

test('contact metadata does not masquerade as Latin prose',()=>{
 for(const suffix of ['t.me/example_channel','desk@example.org','press.office+news@example.net']) {
  assert.equal(sourceLanguage('قال الوزير إن الاجتماع سيعقد في العاصمة. '+suffix),'ar');
  assert.equal(sourceLanguage('الكتاب دانشگاه '+suffix),'unknown');
 }
});
test('scattered acronyms generalize without allowing English phrases',()=>{
 assert.equal(sourceLanguage('أعلنت الوزارة أن نظام GPS يعمل في المدينة وأن جهاز ABC في المحطة وجهاز DEF في المدرسة وجهاز XYZ في المكتبة وجهاز QRS في الجامعة.'),'ar');
 for(const text of ['أعلنت الوزارة أن الاجتماع سيعقد في العاصمة. BIG NEW PUBLIC EVENT TODAY','او گفته که در جلسه حضور داشته است. THE NEW PUBLIC EVENT','BRT تهران'])assert.equal(sourceLanguage(text),'unknown');
});

test('Persian function words outweigh borrowed noun forms; joined plurals need native grammar',()=>{
 for(const text of [
 'لحظه اعلام عضویت ایران در کمیته عمومی کنفرانس آژانس بین المللی انرژی اتمی و شکست آمریکا در انتخابات این کمیته',
 'معاون هماهنگ کننده نیروی هوایی ارتش: سه خلبان ایرانی اسیر هستند و قطر باید پاسخگو باشد',
 'تصاویر منتشرشده از ورود نیروهای محلی به بندر در استان تعز',
 ])assert.equal(sourceLanguage(text),'fa');
 assert.equal(sourceLanguage('أعلنت منظمة شنغهاي للتعاون عن افتتاح المؤتمر الجديد في المدينة'),'ar');
 assert.equal(sourceLanguage('أعلنت الحكومة عن القرار الجديد.\nاین تصمیم برای مردم کشور مهم است.'),'unknown');
});
