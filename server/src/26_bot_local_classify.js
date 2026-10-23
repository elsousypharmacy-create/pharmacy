// ==== MODULE 26_bot_local_classify (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 7.5) الفهم المحلي — من غير أي نداء لجيميني
// الفكرة: أغلب رسايل العملاء بسيطة (تحية، اسم صنف، سعر).
// دي بنفهمها ونرد عليها فورًا من الكود، فالرد بيبقى في أقل من ثانية
// وبيفضل شغال حتى لو جيميني واقع تمامًا.
// ===================================================================

var GREETING_WORDS_ = ['سلام','السلام','عليكم','اهلا','أهلا','هلا','مرحبا','صباح','مساء','ازيك','ازيكم','هاي','هلو','عامل ايه'];
var THANKS_WORDS_   = ['شكرا','شكراً','متشكر','تسلم','ربنا يخليك','جزاك','مرسي','ميرسي'];
var BYE_WORDS_      = ['سلام عليكم','مع السلامه','مع السلامة','باي','تصبح'];
var ORDER_WORDS_    = ['توصيل','دليفري','توصلي','توصل','اطلب','أطلب','اوردر','أوردر','ابعتلي','ابعتهولي','وصلي','العنوان','عنواني'];
var POINTS_WORDS_   = ['نقاط','نقاطي','رصيدي','رصيد النقاط'];
var PRICE_WORDS_    = ['سعر','بكام','كام','ثمن','تمن'];
var AVAIL_WORDS_    = ['موجود','متوفر','متوفره','عندك','عندكم','فيه','في'];

function hasAnyWord_(nText, list) {
  for (var i = 0; i < list.length; i++) {
    if (nText.indexOf(normalizeArabic(list[i])) !== -1) return true;
  }
  return false;
}

// بيشيل كلمات السؤال ويسيب اسم الصنف المحتمل
function extractProductLocally_(text) {
  var n = normalizeArabic(text);
  var drop = [].concat(PRICE_WORDS_, AVAIL_WORDS_, GREETING_WORDS_, ORDER_WORDS_, STOP_WORDS_,
    ['عايز','عاوز','محتاج','ممكن','لو','سمحت','من','فضلك','هل','ياريت','يا','ريت','لي','ليا','واحد','واحده','برجاء','ازاي','ايه','دي','ده',
     'ينفع','ازود','ازيد','اضيف','كمان','برضو','برضه','تاني','عندي','معايا','بس','كده','كدا','حاجه','حاجة','نوع','انا','انت']);
  var words = n.split(' ').filter(function(w) {
    if (w.length < 3 && SHORT_PRODUCT_WORDS_.indexOf(w) === -1) return false;
    for (var i = 0; i < drop.length; i++) {
      if (w === normalizeArabic(drop[i])) return false;
    }
    if (isGenericWord_(w)) return false;
    return true;
  });
  return words.join(' ').trim();
}

// بيرجع رد جاهز لو الرسالة بسيطة، أو null لو محتاجة الذكاء الاصطناعي
function tryLocalReply_(chatId, text, history) {
  const n = normalizeArabic(text);
  const nm = getKnownCustomerName_(chatId);
  const isFirst = !history || history.length === 0;

  // (1) تحية
  if (hasAnyWord_(n, GREETING_WORDS_) && n.split(' ').length <= 4) {
    if (isFirst) {
      return 'وعليكم السلام ورحمة الله 🌸 أهلاً بيك في ' + PHARMACY_NAME +
             (nm ? ' يا ' + nm : '') + '\nتؤمرنا بإيه النهاردة؟';
    }
    return 'أهلاً بيك 🌸 تحت أمرك، محتاج إيه؟';
  }

  // (2) شكر
  if (hasAnyWord_(n, THANKS_WORDS_) && n.split(' ').length <= 5) {
    return 'العفو يا فندم 🌸 تحت أمرك في أي وقت.';
  }

  // (3) نقاط
  if (hasAnyWord_(n, POINTS_WORDS_)) {
    const ph = getCustomerPhone_(chatId);
    if (!ph) return 'ابعتلي رقم موبايلك وأقولك رصيد نقاطك على طول 🌸';
    const pts = getCustomerPointsData(ph);
    return (pts && pts.ok)
      ? 'رصيد نقاطك دلوقتي: ' + pts.total_points + ' نقطة 🌸'
      : 'معلش مقدرتش أوصل لرصيد النقاط دلوقتي، هراجعه وأرد عليك.';
  }

  // (4) سؤال عن صنف — أهم حالة، وبتتحل محليًا بالكامل
  const product = extractProductLocally_(text);
  if (product && product.length >= 3) {
    const results = searchStock(product);
    if (results.length) {
      const answer = buildProductAnswer_(results, product);
      if (!answer.available) {
        escalateToDoctor_(chatId, text, 'مش متوفر: ' + product);
        return answer.text;
      }
      logQuote_(chatId, answer.items || []);
      return answer.text;
    }
    // لقينا اسم صنف بس مش موجود — بس بنتأكد إنه فعلاً سؤال عن صنف
    if (hasAnyWord_(n, PRICE_WORDS_) || hasAnyWord_(n, AVAIL_WORDS_)) {
      logUnavailableRequest_(chatId, product);
      escalateToDoctor_(chatId, text, 'مش متوفر: ' + product);
      return PRODUCT_MISSING_REPLY_;
    }
  }

  return null; // مش عارفين — نسيبها للذكاء الاصطناعي
}

// ===================================================================
// 8) التصنيف — call واحد بس
// ===================================================================

function classifyCustomerMessage(text, history) {
  const prompt = formatHistory(history) +
    'انت بتصنّف رسايل عملاء صيدلية. صنّف الرسالة الجديدة لواحدة بالظبط:\n' +
    '"PRODUCT" = بيسأل عن توفر أو سعر صنف، أو بيحدد نوع من أنواع اتعرضت عليه،.\n' +
    '"ORDER" = عايز يطلب/يوصّل، أو بيبعت عنوان أو رقم تليفون عشان أوردر.\n' +
    '"MEDICAL" = سؤال عن جرعة، تفاعل دوائي، تشخيص، أو وصف عرض أو حالة (عندي برد، جلدي مقشر، صداع…) بيطلب علاج ليها.\n' +
    '"POINTS" = بيسأل عن نقاطه أو رصيده.\n' +
    '"OTHER" = سلام، شكر، مواعيد، عنوان الصيدلية، أي حاجة تانية.\n\n' +
    'لو PRODUCT: استخرج اسم الصنف بس (من الرسالة الجديدة أو من المحادثة اللي فاتت لو بيكمل كلام).\n' +
    'متضفش "ال" التعريف على اسم الصنف.\n' +
    'رد بـ JSON بس من غير أي نص زيادة:\n' +
    '{"type":"...","product":"..."}\n\n' +
    'الرسالة الجديدة: "' + text + '"';

  const raw = callGemini(prompt);
  if (!raw) return { type: 'FAILED', product: '' };
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return { type: parsed.type || 'OTHER', product: (parsed.product || '').trim() };
  } catch (e) {
    return { type: 'OTHER', product: '' };
  }
}