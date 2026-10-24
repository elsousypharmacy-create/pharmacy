// ==== MODULE 27_bot_brain (split from server/Code.js; load order = file name order) ====



// ===================================================================
// 🧠 العقل الجديد: محادثة طبيعية بنداء واحد للموديل
// الكود بيدوّر في المخزون الأول ويدّي الموديل الأصناف المطابقة بأسعارها،
// والموديل بيرد بكلام طبيعي من القايمة دي بس. لو ذكر رقم مش في القايمة
// → الرد بيترمي ونرجع للنظام القديم. يعني الأسعار برضه مستحيل تتخترع.
// ===================================================================
const SMART_BRAIN = true;                     // false = يرجع للنظام القديم
const PHARMACY_PHONE = '01143404023';
const HARD_ESCALATE = ['حامل','مرضعة','مرضع','رضاعة','رضيع'];
/* أدوية جدول/رقابة — زوّد الاسم هنا لو عايز نفس المنع من غير ما تلمس البرومبت */
var CONTROLLED_DRUGS_ = [
  'ترامادول','tramadol','ترامال','tramal',
  'بريجابالين','pregabalin','ليريكا','lyrica',
  'كلونازيبام','clonazepam','ريفوتريل','rivotril',
  'البرازولام','alprazolam','زانكس','xanax','زاناكس',
  'كودايين','codeine','كوديين',
  'أدوية الجدول','ادوية الجدول','دوا جدول','دواء جدول','أدويه الجدول',
  'مخدر','منوم','مهدئ','مهدئات','منومات'
];
var COMPLAINT_MARKERS_ = ['شكوى','شكوه','اشتكي','اشتكيت','اتأخر','اتاخر','تأخير','تاخير','غلط في الطلب','سعر غلط','معاملة','معامله','زعلان','مش راضي'];
var SYMPTOM_WORDS_ = ['صداع','كحه','سخونيه','سخونه','اسهال','امساك','حرقان','حساسيه','طفح','مغص','دوخه','ترجيع','غثيان','زكام','انفلونزا','وجع','هرش','حكه','ارق','حموضه','عيان','تعبان'];

function brainCandidates_(text, history, extra) {
  var seen = {}, out = [];
  function addQ(q, mustHave) {
    q = String(q || '').trim(); if (q.length < 3 && SHORT_PRODUCT_WORDS_.indexOf(q) === -1) return;
    searchStock(q).forEach(function (it) {
      /* صنف من صورة: لازم اسم الماركة نفسه يبقى في اسم الصنف — مش مجرد نفس التركيز أو المادة الفعالة */
      if (mustHave && String(it.key || stockKey_(it.name)).indexOf(mustHave) === -1) return;
      /* بديل بنفس المادة مش بيتقدم للعميل. التطابق القريب المسموح: نفس الماركة بشكل تاني بس */
      if (it.closeMatch && it.closeWhy !== 'form') return;
      var k = it.name + '|' + it.price;
      if (seen[k] || out.length >= 14) return;
      if (it.daysToExpire !== null && it.daysToExpire < MIN_EXPIRY_DAYS_TO_OFFER) return;
      seen[k] = 1; out.push(it);
    });
  }
  if (extra) addQ(extra);
  if (PHOTO_CTX && PHOTO_CTX.items) PHOTO_CTX.items.forEach(function (it) {
    var n = String(it.name || '').trim(); if (!n) return;
    /* فلتر الماركة للعلب بس: اسم مطبوع واضح. خط إيد الروشتة غالبًا اسم علمي (فيتامين د، ال-كارنيتين) وأي ماركة تنفع */
    var brand = it.fromBox ? ((stockKey_(n) || '').split(' ').filter(function (w) { return w.length >= 3; })[0] || '') : '';
    addQ(n + (it.strength ? ' ' + it.strength : ''), brand); addQ(n, brand); if (brand) addQ(brand, brand);
  });
  /* في الصور: أسماء الصورة اتدوّر عليها فوق بفلتر الماركة — منكررش البحث بيها من غير فلتر */
  if (PHOTO_CTX) text = String(text).replace(/\n?\[العميل بعت صورة[\s\S]*$/, '');
  var prod = extractProductLocally_(text);
  addQ(prod);
  prod.split(' ').forEach(function (w) { if (w.length >= 4 && !isFormWord_(w)) addQ(w); });
  /* لو بيكمّل كلام ("التاني"، "الكبير") ندوّر باللي اتقال قبل كده */
  if (out.length < 3 && history && history.length) {
    for (var i = history.length - 1; i >= 0 && i >= history.length - 4; i--) {
      if (history[i].role === 'user') addQ(extractProductLocally_(history[i].text));
    }
  }
  return out;
}

function brainPrompt_(chatId, text, history, items, noSearch) {
  var nm = getKnownCustomerName_(chatId), vph = getVerifiedPhone_(chatId), ph = getCustomerPhone_(chatId);
  var addr = vph ? lastAddress_(vph) : '';
  var dflow = delFlow_(chatId);
  var bs = botSettings_(), sf = safetyGet_(chatId);
  /* بنشيل من ردود البوت القديمة أي "يا + اسم غلط" عشان الموديل ميقلّدهاش */
  var okN = allowedNames_(chatId, history);
  history = (history || []).map(function (h) { return h.role === 'bot' ? { role: 'bot', text: stripVocatives_(h.text, okN) } : h; });
  var safetyLine = '';
  if (sf && (sf.age || sf.clear || sf.note)) {
    safetyLine = 'معلومات الأمان اللي العميل قالها النهارده: ' +
      (sf.age ? 'السن ' + sf.age + ' سنة. ' : '') +
      (sf.clear ? 'مفيش حمل ولا رضاعة ولا أمراض مزمنة ولا أدوية تانية. ' : '') +
      (sf.note ? 'قال: "' + sf.note + '" (فيه مرض مزمن → حوّل للدكتور). ' : '') +
      (sf.age && sf.clear ? '→ متسألش الأسئلة دي تاني (والجرعات والترشيح للدكتور برضه).\n'
                          : '→ اسأل بس عن اللي ناقص.\n');
  }
  var areas = deliveryAreas_(bs), feeInfo = deliveryFeeInfo_(bs);
  var stock = items.length ? items.map(function (it, i) {
    return (i + 1) + ') ' + it.name + ' | السعر: ' + Math.round(it.price) + ' جنيه' +
      (it.units > 1 ? ' | العلبة ' + it.units : '') +
      (it.stock < LOW_STOCK_THRESHOLD ? ' | كمية محدودة' : '') +
      (it.activeKey ? ' | المادة الفعالة: ' + it.activeKey : '') +
      (it.closeMatch && it.closeWhy === 'form' ? ' | تطابق قريب (شكل مختلف' + (it.askedForm ? ': ' + it.askedForm : '') + ')' : '');
  }).join('\n') : '(مفيش أصناف مطابقة للكلام ده في المخزون)';
  return 'انت صيدلي شاب ودود في ' + PHARMACY_NAME + ' (محلة كيل، مصر)، بترد على العملاء على الشات بالعامية المصرية.\n\n' +
    'الأسلوب:\n' +
    '- اكتب زي موظف صيدلية حقيقي بيرد على واتساب: محترم وطبيعي، جمل قصيرة (سطر أو اتنين في الغالب)، من غير رسميات زيادة ولا كلام محفوظ.\n' +
    '  أمثلة من ردود الموظفين الحقيقيين (قلّد الروح دي): "تمام حاضر" / "في توصيل إن شاء الله" / "عامل 180 بس خلصان هيجي بكرة" / "تسلخات احمرار بس؟" / "ده مش موجود دلوقتي".\n' +
    '  كلمة "حضرتك" مرة واحدة في الرسالة بالكتير ومش في كل رسالة. ممنوع الجمل المحفوظة زي: "تحت أمر حضرتك"، "يسعدنا خدمة حضرتك"، "استلمنا"، "نعتذر عن أي إزعاج"، "في أقرب وقت" في كل رد. ومتسألش أكتر من سؤال واحد في الرسالة.\n' +
    '- خاطب العميل بـ "حضرتك". ممنوع "يا فندم" والكلام الشعبي زي "يا غالي" و"يا باشا" و"يا معلم" و"يا حبيبي".\n' +
    '- ممنوع "أهلًا بحضرتك" أو أي ترحيب في نص المحادثة — حتى لو العميل سأل عن حاجة جديدة. الترحيب اتعمل خلاص، ادخل في الموضوع على طول.\n' +
    '- ممنوع تخمّن أو تفترض اسم العميل. استخدم بس "اسم العميل (مؤكد)" لو موجود، أو اسم قاله صراحة ("اسمي محمد"). "اسمي ايه" معناها بيسأل عن اسمه، مش إن اسمه آية.\n' +
    '- ممنوع تكتب "يا" + أي اسم مش هو "اسم العميل (مؤكد)". ومتفترضش إن العميل راجل أو ست: استخدم صيغة محايدة مع "حضرتك" (زي "حضرتك بتاخد أدوية تانية؟").\n' +
    '- لو اسمه معروف ناديه باسمه الأول (أو اللقب + الاسم لو مكتوب زي دكتور/الحاج) أحيانًا، مش في كل رسالة. ممنوع تكتب "أستاذ/ة".\n' +
    '- "ألف سلامة" تتقال بس لو العميل قال صراحة إنه (أو حد معاه) تعبان، ومرة واحدة بس في المحادثة — لو اتقالت قبل كده في ردودك متقولهاش تاني.\n' +
    '- التنسيق: لو بتذكر أكتر من صنف، اكتب جملة قصيرة، وبعدين كل صنف في سطر لوحده بالشكل ده:\n' +
    '  الاسم — السعر جنيه   (للمتوفر)\n  الاسم — مش متوفر   (بس كده، من غير شرح ومن غير بديل)\n' +
    '  وجملة "الصيدلي هيتواصل/هيراجع" تتقال مرة واحدة بس في الآخر، مش جنب كل صنف.\n' +
    '  وبعدهم سطر "الإجمالي: … جنيه" لو فيه أكتر من صنف متوفر، وفي الآخر سؤال قصير. ممنوع تحط الأصناف في جملة طويلة واحدة. القايمة دي مش محسوبة في حد الـ4 سطور.\n' +
    '- نوّع جملك ومتكررش نفس الصيغة في رسايل ورا بعض. الإيموجي: مرة كل 3-4 رسايل بس (مش في كل رسالة)، ومن الرموز دي فقط: ✅ 🌿 📦 💊. ممنوع الوشوش والقلوب والورد وأي رمز تاني. في الطوارئ ممنوع أي إيموجي خالص.\n' +
    '- اسأل سؤال يكمّل الكلام لما يكون مفيد، واعرض التوصيل لما يناسب ("تحب حضرتك نوصلهولك؟").\n\n' +
    'القواعد (لازم):\n' +
    '1. التوافر والأسعار من "المخزون المتاح" تحت بس. السعر يتكتب زي ما هو بالظبط. ممنوع تخترع صنف أو سعر.\n' +
    '2. صنف مكتوب جنبه "تطابق قريب (شكل مختلف)": ده نفس المنتج ونفس الماركة بشكل تاني (نقط بدل شراب مثلًا)، مش بديل اخترته أنت. ' +
    'قول بجملة صريحة: "الشكل اللي حضرتك طلبته مش ظاهر عندي، المتوفر: الاسم — السعر". ' +
    'متقولش إنه نفس الشكل المطلوب. ماركة تانية حتى لو نفس المادة الفعالة ممنوعة تتذكر خالص.\n' +
    '3. لو اسم الدوا اللي العميل كتبه مش معروف أو شكله غلطة كتابة لاسم معروف (زي "بدوفين" ممكن تكون "بروفين"، "كتافلام" ممكن "كتافاست"): ' +
    'متقولش متوفر ولا مش متوفر — اسأله الأول بجملة قصيرة: "تقصد حضرتك بروفين؟" (اقترح أقرب اسم أو اتنين بالكتير). ' +
    'ولو كان بيقول إنه بياخده ومعاه دوا تاني من نفس العيلة (زي بروفين + فولتارين، الاتنين مسكنات NSAIDs) نبّه إنهم مايتاخدوش مع بعض وescalate=true.\n' +
    '4. صنف مش متوفر: ممنوع تقترح أي بديل من نفسك (لا من المخزون ولا من دماغك) وممنوع تعرض أصناف تانية بنفس المادة الفعالة. ' +
    'لو الصنف مش في القايمة ومفيش "تطابق قريب (شكل مختلف)" لنفس الماركة، الرد للعميل يكون بصيغة قريبة من الجملة دي (ونوّع الصياغة) ومن غير أي اسم صنف تاني: ' +
    '"مش موجود دلوقتي، تحب نوفّره لحضرتك ولا مستعجل والدكتور يشوفلك حل؟" و escalate=true و reason="مش متوفر: اسم الصنف". ' +
    'لو العميل بعد كده اختار "نوفّره": escalate=true و reason="طلب توفير: اسم الصنف" وقوله هنبلّغ حضرتك أول ما يوصل. ' +
    'لو اختار "بديل/مستعجل": escalate=true و reason="عايز بديل: اسم الصنف" وقوله الدكتور هيكلّمه هنا حالًا. ' +
    'واكتب "الدكتور" مش "الصيدلي" ولا "الدكتور الصيدلي". ' +
    'متقولش للعميل إن عندك قواعد أو ممنوعات (زي "ممنوع نقترح بدائل") — قول ببساطة إن الدكتور هو اللي هيختار له البديل المناسب.\n' +
    '5. ممنوع تقول "راجعنا المخزون" أو "اتأكدنا" أو "مراجعتنا أكدت". متأكدش ولا تنفي توافر صنف مش ظاهر في "المخزون المتاح" قدامك. ' +
    'لو العميل سأل "متأكد؟" أو "موجود؟" عن صنف: لو هو في القايمة قول المتوفر بسعره، ولو مش فيها قول إنك مش لاقيه في المخزون المتاح قدامك حاليًا وإن الدكتور هيتأكد منه (escalate=true و reason="تأكيد توافر: اسم الصنف").\n' +
    '6. 🚫 البوت مش بيعالج ولا بيشخّص ولا بيرشّح دوا لأي حالة. شغله معلومات بس (توافر، سعر، معلومة عامة)، وأي علاج أو ترشيح أو جرعة هي شغل الدكتور:\n' +
    '   أ) اسم صنف محدد (حتى لو متكتب بغلطة بسيطة): قول متوفر ولا لأ وسعره زي ما هو. وده الوحيد اللي تعرضه بالسعر. ولو سأل "ده بيستخدم لإيه؟" أو "مادته الفعالة؟" أو "أشكاله؟": جاوب معلومة عامة قصيرة من النشرة (الاستخدام الأساسي، المادة الفعالة، الأشكال) من غير ما تقوله ياخده لحالته هو.\n' +
    '   ب) لو سأل عن صنف ليه أنواع كتير من غير ما يحدد (زي "عندك بنادول؟"): قول إنه متوفر بأنواعه واسأله يحدد النوع أو الشكل اللي يقصده. متسألوش بيشتكي من إيه ومتختارش له.\n' +
    '   ج) لو وصف عرض أو حالة أو مرض ومحدّدش اسم صنف (زي "عندي كحة"، "جلدي مقشر"، "عندي جفاف"، "صداع"): ممنوع ترشّح أو تعرض أي دوا أو منتج أو سعر، وممنوع تشخّص أو تقول خطوات علاج أو طرق منزلية. ' +
    'قايمة المخزون تحت ممكن تكون مطابقة غلط لكلماته (زي "مقشر" مع أداة تقشير) — متعرضهاش ومتذكرش أسماءها. اديله معلومة عامة قصيرة عن الحالة لو مفيدة (إيه هي بشكل عام، ومتى يروح لدكتور فورًا)، وقوله إن الدكتور هيرشحله المناسب لحالته هنا في أقرب وقت. ' +
    'escalate=true و reason="وصف حالة: ...".\n' +
    '   د) "ايه الفرق بين X و Y؟": اشرح الفرق العام بينهم باختصار كمعلومة (نص سطر لكل صنف)، من غير ما تقوله ياخد أنهي واحد. ولو عايز اختيار لحالته: الدكتور هو اللي يرشّح.\n' +
    '   هـ) الأطفال: نفس القواعد. معلومات عامة بس، وأي علاج أو دوا لطفل → escalate=true من غير ما تعرض أصناف.\n' +
    '7. الجرعات: ممنوع تقول جرعة أو عدد مرات أو مدة استخدام أو أقصى عدد في اليوم لأي دوا ولأي عميل، حتى لو من غير روشتة — الجرعة بتتحدد حسب حالة الشخص. ' +
    'لو سأل: قوله بلطف إن الجرعة بتتحدد حسب حالته والدكتور هيحددها له، و escalate=true. وكمان أي سؤال عن تداخل بين أدوية، أو حمل/رضاعة، أو أمراض مزمنة، أو دوا روشتة (مضاد حيوي، ضغط، سكر، قلب، أعصاب، كورتيزون، هرمونات…)، أو أعراض خطيرة → escalate=true.\n' +
    '   "باخد/بستعمل/باخد علاج اسمه X" معناها إنه بياخد X فعلًا — ده دوا تاني للأمان، مش طلب شرا: متقولش X متوفر أو مش متوفر. أي سؤال عن إنه ياخده مع حاجة تانية → escalate=true.\n' +
    '   لما تحوّل: قول بلطف وبكلامك إن الدكتور هيكلمه هنا في أقرب وقت، ومتكررش نفس الجملة. كل رسالة تتقيّم لوحدها: متحولش لو الرسالة الجديدة سؤال معلومات عادي (توافر/سعر/استخدام عام).\n' +
    '8. order.lines لازم تضم كل الأصناف اللي العميل وافق عليها في المحادثة كلها (حتى لو وافق بكلمة زي "آه/اه/اخ/تمام/ماشي")، مش آخر صنف بس. ' +
    'ولو العميل قال "على العنوان المسجل" اكتب في address نفس الجملة دي بالظبط والسيستم هيجيب العنوان.\n' +
    '9. التوصيل متاح. متطلبش عنوان إلا لو العميل طلب توصيل فعلًا. لو عايز يطلب: اتأكد من الأصناف والكميات، واطلب الموبايل والعنوان بالتفصيل لو ناقصين. ' +
    'لما يبقى عندك الأصناف + الموبايل + العنوان: املا order (وفي order.lines اكتب اسم كل صنف بالظبط زي ما هو مكتوب في المخزون والكمية)، ' +
    'وفي reply قول جملة قصيرة بس إنك هتبعتله ملخص الطلب يأكده — متقولش إن الأوردر اتسجل أو اتبعت أو وصل للصيدلية. التسجيل بعد تأكيد العميل للملخص بس.\n' +
    '   العنوان في order لازم يكون كامل: منطقة + شارع + علامة مميزة أو رقم عمارة، أو لوكيشن. لو ناقص جزء، اسأل عن الجزء الناقص بس ومتملأش order.\n' +
    '   ' + feeInfo.prompt +
    (areas.length ? ' مناطق التوصيل بالاسم: ' + areas.join('، ') + '. لو العنوان المكتوب بره المناطق دي متعملش order.' : '') +
    (bs.hours ? ' مواعيد العمل: ' + bs.hours + '.' : ' مواعيد العمل: لو اتسأل قول إن الصيدلي هيأكدها، ومتخترعش مواعيد.') + '\n' +
    (noSearch ? '10. ممنوع تطلب بحث تاني — رد على العميل دلوقتي من القايمة اللي قدامك.\n'
              : '10. أسماء المخزون غالبًا بالإنجليزي. لو سأل عن صنف ومش لاقيه في القايمة: رجّع search باسمه التجاري بالإنجليزي (مثلًا فولتارين → VOLTAREN) وسيب reply فاضي.\n') +
    '11. الطوارئ: لو فيه حالة خطيرة دلوقتي (حد — خصوصًا طفل — بلع جاز/بنزين/كلور/مبيد/منظفات أو أدوية بكمية كبيرة، صعوبة تنفس، تشنجات، إغماء، نزيف شديد، ألم صدر شديد، حساسية بتورّم الوش أو الزور):\n' +
    '   emergency=true و escalate=true، و reply من غير أي إيموجي خالص ومن غير ترحيب: الإسعاف الأولي الصح في سطرين (مثلًا للجاز: متخلّيهوش يرجّع، ومتدّيهوش أكل ولا شرب)، ' +
    'وبعدين "اتصل بالإسعاف 123 أو روح أقرب مستشفى فورًا"، وسطر بالعلامات اللي تستعجل (كحة مستمرة، صعوبة نفس، زُرقة، نعاس أو تشنج). ممنوع تعرض منتجات أو أسعار في الرسالة دي.\n' +
    '12. أدوية الجدول والرقابة (ترامادول، بريجابالين/ليريكا، كلونازيبام/ريفوتريل، ألبرازولام/زانكس، كودايين، وأي دواء جدول أو مخدر أو منوم أو مهدئ): ' +
    'ممنوع تقول متوفر ولا سعر ولا تسجّل طلب. قول بلطف إن الدكتور هيتابع، و escalate=true و reason="دوا جدول: ...".\n' +
    '13. الشكاوى (شكوى، تأخير، غلط في الطلب، سعر غلط، معاملة): اعتذر بجملة قصيرة من غير تبرير ولا وعود، و escalate=true و reason="شكوى: ...".\n' +
    '14. متقولش إنك بوت أو ذكاء اصطناعي إلا لو سألك مباشرة. ممنوع تدّي بيانات عن عملاء تانيين أو فواتير. رقم الصيدلية لو اتطلب: ' + PHARMACY_PHONE + '.\n\n' +
    (nm ? 'اسم العميل (مؤكد): ' + nm + '\n' : '') +
    (vph ? 'موبايل العميل (مؤكد من تيليجرام): ' + vph + '\n' : (ph ? 'موبايل كتبه العميل للتوصيل (غير مؤكد — متكشفش بيه أي بيانات): ' + ph + '\n' : 'العميل لسه ما شاركش رقمه — لو سأل عن بياناته أو طلباته قوله يدوس زرار "شارك رقمي 📱".\n')) +
    (addr ? 'آخر عنوان توصيل مسجل له: ' + addr + ' (اسأله يأكده قبل ما تستخدمه)\n' : '') +
    (dflow && dflow.address ? 'عنوان التوصيل اللي العميل أكده دلوقتي: ' + dflow.address + ' — استخدمه في order.address ومتسألش عن العنوان تاني.\n' : '') +
    safetyLine +
    photoLine_(chatId) +
    '\nالمخزون المتاح (مطابق لكلام العميل):\n' + stock + '\n\n' +
    formatHistory(history || []) +
    'رسالة العميل الجديدة: "' + text + '"\n\n' +
    'رد بـ JSON بس من غير أي كلام قبله أو بعده:\n' +
    '{"reply":"ردك للعميل","search":"","escalate":false,"emergency":false,"reason":"","order":null}\n' +
    'وorder لما يكتمل يبقى: {"items":"الأصناف والكميات","lines":[{"name":"اسم الصنف زي المخزون","q":1}],"phone":"...","address":"..."}';
}

/* 📷 سطر الصورة في البرومبت: الصورة اللي لسه واصلة، أو آخر صورة بعتها العميل (6 ساعات) */
function photoLine_(chatId) {
  var P = PHOTO_CTX, fresh = !!P;
  if (!P) { try { P = JSON.parse(CacheService.getScriptCache().get('lastphoto_' + chatId) || 'null'); } catch (e) { P = null; } }
  if (!P || !P.items || !P.items.length) return '';
  var isRx = P.kind === 'prescription';
  var unreadLine = P.unread ? ('→ تنبيه مهم: ' + P.unread + ' صورة من اللي بعتها العميل ما اتقرتش (ممكن تكون روشتة أو حاجة تانية). قول للعميل بوضوح وبجملة قصيرة إن فيه صورة الدكتور هيراجعها بنفسه، وماتقولش إن كل الصور اتشافت.\n') : '';
  var names = P.items.map(function (it) { return it.name + (it.strength ? ' ' + it.strength : '') + (it.use ? ' [استخدامه: ' + it.use + ']' : '') + (it.hand ? ' {من الروشتة}' : '') + (it.sure === false ? ' (مش واضح)' : ''); }).join('، ');
  var s = (fresh ? 'العميل بعت دلوقتي صورة ' : 'آخر صورة بعتها العميل من شوية كانت ') + (isRx ? 'روشتة' : 'علبة/منتج') + ' مكتوب فيها: ' + names + '.\n' +
    (fresh ? '' : '→ لو العميل قال "الصورة" أو "الورقة" أو "اسمه ايه" أو "الدوا ده" يبقى قصده على الصورة دي — قوله الاسم المكتوب فيها على طول ومتطلبش يبعتها تاني.\n') +
    '→ قاعدة الماركة (مهمة جدًا): قول "متوفر" بس لو اسم الصنف في المخزون هو نفس الاسم التجاري اللي في الصورة. ' +
    'نفس المادة الفعالة باسم تاني = منتج تاني (مثال: Xigduo XR ≠ داباليكس اكسار) → الأصناف دي مش متوفرة، ' +
    'وممنوع تقدّم البديل كأنه هو نفس المنتج.\n';
  s += unreadLine;
  if (isRx) s += '→ دي روشتة' + ((P.n || 1) > 1 ? ' — وكل الأصناف اللي في الصور (حتى العلب) تعتبر من الروشتة' : '') + ': قوله المتوفر منها بالسعر والإجمالي، والمش متوفر يتكتب "مش متوفر" بس. ' +
    'قاعدة المش متوفر: ممنوع تقترح أي بديل أو أي صنف بنفس المادة الفعالة. للأصناف المش متوفرة اكتب مرة واحدة في الآخر بصيغة قريبة من: "مش موجود دلوقتي، تحب نوفّره لحضرتك ولا مستعجل والدكتور يشوفلك حل؟" و escalate=true. متقولش جرعات ومتذكرش أسماء بديلة.\n' +
    '→ أي صنف مكتوب جنبه (مش واضح): اكتبه في سطر لوحده بالشكل ده: الاسم — مش واضح في الروشتة (الدكتور هيأكده). متقولش عليه متوفر ولا مش متوفر.\n' +
    '→ أي صنف متوفر ومكتوب جنبه {من الروشتة}: اكتب بعد سعره "(هيتأكد مع الدكتور)" — لأن قراية خط الإيد ممكن تغلط.\n' +
    '→ اختم دايمًا بسؤال يقفل الطلب لو فيه حاجة متوفرة، زي: "تحب حضرتك نجهّز المتوفر ونوصّله؟"\n';
  else if (P.rx) s += '→ ده دوا بروشتة: متقولش جرعة. قول التوافر والسعر' + (P.label && fresh ? '، والمكتوب على العلبة (بالعربي بس): "' + P.label + '"' : '') +
    '. لو مش متوفر: ممنوع تقترح أي بديل أو أي صنف بنفس المادة الفعالة. قول بصيغة قريبة من (ونوّع الصياغة): "مش موجود دلوقتي، تحب نوفّره لحضرتك ولا مستعجل والدكتور يشوفلك حل؟" و escalate=true. ' +
    'والجرعة حسب الدكتور المعالج والدكتور هيأكدها (escalate=true لو سأل عن الاستعمال). ولو متوفر اختم بسؤال: "تحب حضرتك نجهّزه أو نوصّله؟"\n';
  else if (fresh) s += '→ رد على سؤاله عن الأصناف دي (التوافر والسعر، ومعلومة عامة عن استخدامه لو سأل — من غير جرعات: الجرعة والترشيح للدكتور). ' +
    'ممنوع تقترح أي بديل أو أي صنف بنفس المادة الفعالة. لو مش متوفر قول بصيغة قريبة من (ونوّع الصياغة): "مش موجود دلوقتي، تحب نوفّره لحضرتك ولا مستعجل والدكتور يشوفلك حل؟" و escalate=true.\n';
  return s;
}

function brainParse_(raw) {
  if (!raw) return null;
  try {
    var t = String(raw).replace(/```json|```/g, '').trim();
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a === -1 || b === -1) return null;
    return JSON.parse(t.slice(a, b + 1));
  } catch (e) { return null; }
}

function keywordHit_(nText, list) {
  for (var i = 0; i < list.length; i++) {
    var k = normalizeArabic(list[i]);
    if (k && nText.indexOf(k) !== -1) return list[i];
  }
  return '';
}
function replyHasDosing_(reply) {
  var n = toAsciiDigits_(normalizeArabic(reply));
  if (/كل\s+\d+\s*(ساع|يوم|مره)/.test(n)) return true;
  if (/\d+\s*مرات?\s*(في\s*اليوم|يوميا)/.test(n)) return true;
  if (/(قرص|حبه|كبسوله|نقط)\s+كل\s+\d+/.test(n)) return true;
  if (/لمدة\s+\d+\s*(يوم|ايام|اسبوع)/.test(n)) return true;
  if (/(الجرعه|جرعه)\s*\d+/.test(n)) return true;
  return false;
}
function textHasSymptom_(text) {
  var n = normalizeArabic(text);
  for (var i = 0; i < SYMPTOM_WORDS_.length; i++) if (n.indexOf(normalizeArabic(SYMPTOM_WORDS_[i])) !== -1) return true;
  return false;
}
function customerNamedItem_(text, history, it) {
  var blob = String(text || '');
  (history || []).forEach(function (h) { if (h.role === 'user') blob += ' ' + h.text; });
  var nk = stockKey_(blob);
  var toks = String(it.key || stockKey_(it.name)).split(' ').filter(function (w) { return w.length >= 4; });
  for (var i = 0; i < toks.length; i++) if (nk.indexOf(toks[i]) !== -1) return true;
  var qw = String(extractProductLocally_(text) || '').split(' ').filter(function (w) { return w.length >= 4; });
  var ik = it.key || '';
  for (var j = 0; j < qw.length; j++) {
    var keys = ingAliasKeys_(qw[j]);
    for (var a = 0; a < keys.length; a++) {
      if (ik && ik.indexOf(keys[a]) !== -1) return true;
    }
  }
  return false;
}
function replyMentionsItem_(reply, it) {
  var nr = normalizeArabic(reply), nn = normalizeArabic(it.name);
  if (nn && nn.length >= 4 && nr.indexOf(nn) !== -1) return true;
  var raw = String(it.name || '').toLowerCase();
  return !!(raw && String(reply).toLowerCase().indexOf(raw) !== -1);
}
/* حارس كود: جرعة، أو ترشيح دوا لعرض، أو بديل العميل ماسمّهوش.
   نفس الماركة بشكل تاني (closeWhy=form) مسموح. نفس المادة الفعالة بماركة تانية ممنوعة. */
function botReplyBlocked_(reply, text, items, history) {
  if (replyHasDosing_(reply)) return 'جرعة';
  /* الرد ميكشفش قواعد البوت ولا يقول إنه "راجع المخزون" ولا جمل غريبة عن إعادة إرسال */
  if (/ممنوع\s*نقترح|ممنوع\s*نرشح|مراجعتنا\s*(للمخزون|اكدت)|راجعنا\s*المخزون|اتاكدنا\s*من\s*المخزون|اتبعتت\s*تاني/.test(normalizeArabic(reply))) return 'صياغة ممنوعة';
  var named = (items || []).some(function (it) { return customerNamedItem_(text, history, it); });
  var nreply = normalizeArabic(reply);
  if (/مش لاقي نفس الاسم|بنفس الماده الفعاله/.test(nreply)) return 'قائمة بدائل';
  if (textHasSymptom_(text) && !named) {
    if (/✅|❌/.test(reply)) return 'ترشيح علاج';
    if (/(انصح|استعمل|استخدم|يناسبك|رشحلك|جرب |افضل حاجه|احسن حاجه)/.test(nreply)) return 'ترشيح علاج';
    if (/(^|\s)(خد|خدي|خده)\s/.test(' ' + nreply + ' ')) return 'ترشيح علاج';
    if (/\d+\s*جنيه/.test(toAsciiDigits_(reply))) return 'ترشيح علاج';
  }
  var foreign = (items || []).filter(function (it) {
    if (it.closeMatch && it.closeWhy === 'form') return false;
    if (!replyMentionsItem_(reply, it)) return false;
    return !customerNamedItem_(text, history, it);
  });
  if (foreign.length && /مش متوفر|مش موجود|بديل|انصح|استعمل/.test(nreply)) return 'بديل';
  return '';
}
function claimsOrderSaved_(reply) {
  return /(الاوردر اتسجل|الاوردر اتبعت|الطلب اتسجل|الطلب اتبعت|سجلت الاوردر|سجلت الطلب|وصل للصيدليه|هيوصل الاوردر)/.test(normalizeArabic(reply));
}
function heldSilence_(chatId, text, arrivalUnix) {
  try {
    tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, reply_markup: holdKb_(chatId, true),
      text: '💬 ' + (getKnownCustomerName_(chatId) || 'العميل') + ':\n"' + String(text || '').slice(0, 2500) + '"\n\n↩️ اعمل Reply عشان ترد.\n[#c' + chatId + ']' });
  } catch (e) {}
  saveConversationTurn(chatId, text, '[الصيدلي بيرد بنفسه]', 'bot', arrivalUnix);
}
/* طلب اسم منتج ومفيش نفس المنتج في المخزون (ولا نفس الماركة بشكل تاني).
   بيرجع اسم الصنف لو لازم نرد بجملة "مش متوفر" ونحوّل للدكتور، أو فاضي لو الرسالة مش طلب صنف. */
function productAskMiss_(text) {
  if (PHOTO_CTX) return '';
  var prod = extractProductLocally_(text);
  if (!prod || prod.length < 3) return '';
  var n = normalizeArabic(text);
  if (/(بيتعارض|تفاعل|جرعه|استخدام|بيستخدم|الفرق|اعراض|حامل|رضاع|روشت)/.test(n)) return '';
  var choice = { 'نوفره': 1, 'نوفر': 1, 'وفر': 1, 'وفره': 1, 'مستعجل': 1, 'مستعجلين': 1 };
  var follow = { 'الكبير': 1, 'الصغير': 1, 'الاول': 1, 'الاولى': 1, 'نفسه': 1, 'نفسها': 1 };
  var words = prod.split(' ').filter(function (w) {
    if (w.length < 4 || isFormWord_(w) || isGenericWord_(w) || choice[w] || follow[w]) return false;
    for (var i = 0; i < SYMPTOM_WORDS_.length; i++) if (w.indexOf(normalizeArabic(SYMPTOM_WORDS_[i])) !== -1) return false;
    return true;
  });
  if (!words.length) return '';
  var asked = false, parts = {};
  n.split(' ').forEach(function (w) { parts[w] = 1; });
  ['عندك','عندكم','موجود','متوفر','متوفره','سعر','بكام','كام','فيه'].forEach(function (w) {
    if (parts[normalizeArabic(w)]) asked = true;
  });
  var lead = { 'عايز': 1, 'عاوز': 1, 'محتاج': 1, 'لو': 1, 'سمحت': 1, 'فضلك': 1 };
  var msgWords = n.split(' ').filter(Boolean);
  var content = msgWords.filter(function (w) {
    return !lead[w] && !isGenericWord_(w) && !isFormWord_(w) && !choice[w] && !follow[w] && w.length >= 5;
  });
  var bareName = content.length >= 1 && content.length <= 3 && msgWords.length <= 6 && content.join(' ') === words.join(' ');
  var chatty = { 'ايه': 1, 'اي': 1, 'ازاي': 1, 'ليه': 1, 'عامل': 1, 'عامله': 1, 'في': 1, 'اخبار': 1, 'الاخبار': 1, 'اخبارك': 1 };
  if (!asked && msgWords.some(function (w) { return chatty[w]; })) return '';
  if ((hasAnyWord_(n, GREETING_WORDS_) || hasAnyWord_(n, THANKS_WORDS_)) && !asked) return '';
  if (!asked && !bareName) return '';
  function hits_(q) {
    return searchStock(q).some(function (it) { return !it.closeMatch || it.closeWhy === 'form'; });
  }
  if (hits_(prod)) return '';
  for (var s = 0; s < words.length; s++) if (hits_(words[s])) return '';
  return words.join(' ');
}
/* بيرجع true لو رد وخلص، false لو لازم النظام القديم يكمّل */
function smartCustomerReply_(chatId, text, history, arrivalUnix) {
  if (!SMART_BRAIN) return false;
  var T_START = Date.now();
  if (holdOn_(chatId)) { heldSilence_(chatId, text, arrivalUnix); return true; }
  try {
    var miss = productAskMiss_(text);
    if (miss) {
      if (holdOn_(chatId)) { heldSilence_(chatId, text, arrivalUnix); return true; }
      escalateToDoctor_(chatId, text, 'مش متوفر: ' + miss);
      if (holdOn_(chatId) || sendTelegram_(chatId, PRODUCT_MISSING_REPLY_) === false) { heldSilence_(chatId, text, arrivalUnix); return true; }
      saveConversationTurn(chatId, text, PRODUCT_MISSING_REPLY_, 'bot', arrivalUnix);
      return true;
    }
    var items = brainCandidates_(text, history, '');
    var res = brainParse_(callGemini(brainPrompt_(chatId, text, history, items)));
    if (!res) res = brainParse_(callGemini(brainPrompt_(chatId, text, history, items)));   /* محاولة تانية لو الرد مش JSON */
    if (res && res.search && !res.reply) {
      items = brainCandidates_(text, history, res.search);
      res = brainParse_(callGemini(brainPrompt_(chatId, text, history, items, true)));
    }
    if (!res || !res.reply) {
      if (holdOn_(chatId)) { heldSilence_(chatId, text, arrivalUnix); return true; }
      Logger.log('العقل مردش رد صالح'); return false;
    }
    if (holdOn_(chatId)) { heldSilence_(chatId, text, arrivalUnix); return true; }

    var reply = stripVocatives_(String(res.reply).trim(), allowedNames_(chatId, history));
    if (!reply) return false;

    /* الأسعار المسموحة: المخزون اللي قدامه + اللي اتعرض قبل كده + رسوم التوصيل */
    var allowed = items.map(function (it) { return Math.round(it.price); });
    items.forEach(function (it) {
      if (it.units) allowed.push(Math.round(it.units));
      (String(it.name).match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) { allowed.push(Math.round(parseFloat(n))); });
    });
    try { JSON.parse(CacheService.getScriptCache().get('quoted_' + chatId) || '[]').forEach(function (q) { allowed.push(q.price); }); } catch (e) {}
    (history || []).forEach(function (h) {
      (toAsciiDigits_(h.text).match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) { allowed.push(Math.round(parseFloat(n))); });
    });
    (toAsciiDigits_(text).match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) { allowed.push(Math.round(parseFloat(n))); });
    var bs = botSettings_(), feeInfo = deliveryFeeInfo_(bs);
    if (feeInfo.kind === 'fee') allowed.push(Math.round(feeInfo.n));
    /* الإجمالي: أي مجموع لأسعار الأصناف اللي قدامه (+ التوصيل) مسموح */
    var ps = items.slice(0, 12).map(function (it) { return Math.round(it.price); }), sums = [0];
    ps.forEach(function (pr) { sums = sums.concat(sums.map(function (s) { return s + pr; })); });
    var feeN = feeInfo.kind === 'fee' ? Math.round(feeInfo.n) : 0;
    sums.forEach(function (s) { if (s) { allowed.push(s); if (feeN) allowed.push(s + feeN); } });
    var phones = [getCustomerPhone_(chatId), extractPhone_(text), PHARMACY_PHONE];
    (history || []).forEach(function (h) { if (h.role === 'user') phones.push(extractPhone_(toAsciiDigits_(h.text))); });
    var bad = brainPriceGuard_(reply, allowed, phones.filter(Boolean));
    if (bad) {
      Logger.log('العقل كتب ' + bad + ' مش من المخزون — الرد اترفض: ' + reply);
      return false;
    }

    /* طوارئ: رد من غير أي إيموجي + تنبيه عاجل */
    if (res.emergency) {
      if (holdOn_(chatId)) { heldSilence_(chatId, text, arrivalUnix); return true; }
      reply = sanitizeBotEmoji_(reply, 'none');
      sendTelegramStaff(reply, chatId);
      saveConversationTurn(chatId, text, reply, 'bot', arrivalUnix);
      escalateToDoctor_(chatId, text, '🚨🚨 طوارئ — كلّم العميل فورًا' + (res.reason ? ' (' + res.reason + ')' : ''));
      return true;
    }

    reply = String(reply).replace(/الدكتور الصيدلي/g, 'الدكتور').replace(/الصيدلي (هيتواصل|هيراجع|هيكلم|هيرد|هيتأكد|هيحدد)/g, 'الدكتور $1');
    /* إيموجي الزينة (🌿📦💊) مش في رسالتين ورا بعض. ✅ جزء من القايمة فبيفضل. */
    try {
      var lastBot = ''; (history || []).forEach(function (h) { if (h.role === 'bot') lastBot = String(h.text || ''); });
      if (/[🌿📦💊]/.test(lastBot)) reply = String(reply).replace(/[🌿📦💊]/g, '').replace(/[ \t]+$/gm, '');
    } catch (eEm) {}
    var blocked = botReplyBlocked_(reply, text, items, history);
    if (blocked) {
      var missingLine = blocked === 'قائمة بدائل';
      reply = missingLine ? PRODUCT_MISSING_REPLY_ : 'الدكتور هيكلم حضرتك هنا في أقرب وقت';
      escalateToDoctor_(chatId, text, missingLine ? ('مش متوفر: ' + (extractProductLocally_(text) || 'صنف')) : ('حارس: ' + blocked));
      if (holdOn_(chatId) || sendTelegram_(chatId, reply) === false) { heldSilence_(chatId, text, arrivalUnix); return true; }
      saveConversationTurn(chatId, text, reply, 'bot', arrivalUnix);
      return true;
    }

    var dfo = delFlow_(chatId);
    /* وصف حالة/عرض: الأصناف اللي لقيناها مطابقة غلط لكلام العميل ومتعرضتش — منسجلهاش كأسعار اتعرضت */
    var symptomOnly = !!res.escalate && /^وصف حالة/.test(String(res.reason || '')) && !/[✅❌]/.test(reply);
    if (items.length && !symptomOnly) quotedAdd_(chatId, items);
    if (res.escalate) escalateToDoctor_(chatId, text, res.reason || 'الموديل طلب مراجعة الدكتور');
    if (!items.length && /مش متوفر|مش موجود|غير متوفر/.test(reply)) logUnavailableRequest_(chatId, extractProductLocally_(text) || text);
    if (items.length && !symptomOnly) logQuote_(chatId, items.slice(0, MAX_RESULTS_TO_SHOW));

    if (res.order) {
      res.order.address = res.order.address || (dfo && dfo.address) || '';
      res.order.phone = res.order.phone || getCustomerPhone_(chatId);
      /* "على العنوان المسجل" → نحط العنوان الحقيقي، ولو مفيش عنوان متسجل نسأله بدل ما نكتب كلمة "المسجل" في الطلب */
      if (/مسجل|متسجل|كتسجل|نفس العنوان|العنوان القديم|زي المر[ةه]/.test(String(res.order.address))) {
        var vphO = getVerifiedPhone_(chatId), realA = (dfo && dfo.address) || (vphO ? lastAddress_(vphO) : '');
        if (realA) res.order.address = realA;
        else {
          res.order.address = '';
          reply = 'مش لاقي عنوان متسجل لحضرتك عندنا. ممكن تكتب العنوان بالتفصيل (المنطقة والشارع وعلامة مميزة) أو تبعت اللوكيشن؟';
        }
      }
    }
    var orderReady = false;
    if (res.order && res.order.phone && res.order.address && (res.order.items || (res.order.lines || []).length)) {
      var acO = addressComplete_(res.order.address), arO = addressInDeliveryArea_(res.order.address);
      if (!arO.ok) {
        reply = outOfAreaReply_();
        escalateToDoctor_(chatId, res.order.address, 'عنوان بره منطقة التوصيل');
      } else if (!acO.ok) reply = addressAsk_(acO);
      else {
        orderReady = true;
        if (claimsOrderSaved_(reply)) reply = 'هبعت لحضرتك ملخص الطلب عشان تأكده. الأوردر مش بيتسجل غير بعد تأكيد حضرتك.';
      }
    } else if (res.order && claimsOrderSaved_(reply)) {
      reply = 'لسه بنكمّل بيانات الطلب. الأوردر مش بيتسجل غير بعد ملخص وتأكيد من حضرتك.';
    }
    /* رد صورة من غير سؤال → نقفله بسؤال الطلب. جملة "مش متوفر" تفضل لوحدها. */
    if (PHOTO_CTX && !/مش (موجود|متوفر)[^؟?]*(نوفّر|نوفر|نجيب)/.test(reply) && !/[؟?]$/.test(String(reply).replace(/[\s\uFE0F\p{Extended_Pictographic}]+$/gu, '')))
      reply += '\n\nتحب حضرتك نجهّز المتوفر ونوصّله؟';
    humanPause_(T_START);
    if (holdOn_(chatId) || sendTelegram_(chatId, reply) === false) { heldSilence_(chatId, text, arrivalUnix); return true; }
    saveConversationTurn(chatId, text, reply, 'bot', arrivalUnix);

    if (orderReady) {
      saveCustomerPhone_(chatId, String(res.order.phone));
      if (holdOn_(chatId)) return true;
      var sum = sendOrderSummary_(chatId, res.order);
      if (holdOn_(chatId)) return true;
      if (sum) saveConversationTurn(chatId, '[مستني تأكيد الطلب]', sum, 'bot', arrivalUnix);
      else sendTelegram_(chatId, 'مش لاقي الأصناف دي متوفرة في المخزون دلوقتي، فمش هقدر أجهّز ملخص الطلب.');
    } else if (res.order && !res.order.phone && !getVerifiedPhone_(chatId)) {
      tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE, text: 'عشان نكمّل الطلب، دوس على زرار تسجيل الرقم تحت.' });
    } else {
      try { maybeAskPhone_(chatId); } catch (e) {}
    }
    return true;
  } catch (e) {
    Logger.log('خطأ smartCustomerReply_: ' + e.message);
    return false;
  }
}
/* رد فوري جدًا بيكشف إنه بوت: لو الرد جهز في أقل من ~4 ثواني نستنى الباقي (3-5 ثواني إجمالًا) ونوري "بيكتب…" */
function humanPause_(t0) {
  try {
    var want = 3000 + Math.floor(Math.random() * 2500), left = want - (Date.now() - t0);
    if (left > 0) Utilities.sleep(left);
  } catch (e) {}
}
