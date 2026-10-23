// ==== MODULE 30_stock (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 3) البحث في المخزون — تطبيع عربي قوي + ترتيب بالأولوية
// ===================================================================

// بيوحّد شكل الكلمة: الهمزات، الألف، التاء المربوطة، الياء، التطويل، وأل التعريف
function normalizeArabic(s) {
  var t = String(s || '')
    .replace(/&#\d+;/g, ' ')
    .replace(/[\u0640]/g, '')                 // التطويل ـــ
    .replace(/[\u064B-\u0652]/g, '')          // التشكيل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064Aa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
  return t;
}

// بيشيل "ال" التعريف ويوحّد الألف الزيادة (بنادول = بانادول)
function stockKey_(s) {
  return normalizeArabic(s)
    .split(' ')
    .map(function(w){ return w.length > 3 && w.indexOf('ال') === 0 ? w.substring(2) : w; })
    .join(' ')
    .replace(/ا/g, '');   // بنشيل الألف خالص من مفتاح المقارنة
}

// كلمات منتشرة مش بتفيد في البحث
var STOP_WORDS_ = ['عندك','عندكم','عايز','عاوز','محتاج','ممكن','فيه','في','هل','لو','سمحت','من','فضلك','سعر','كام','بكام','علبه','علبة','شريط','برشام','دوا','دواء','صنف','طيب','طب','وفيه','وعندكم','موجود','متوفر','لسه','حضرتك','برضو','كمان'];

// كلمات كلام عادي مش أسماء أصناف ("اعرض" اتطابقت مع صنف "صن سويت عرض" لأن stockKey_ بيشيل الألف).
// بتتشال من البحث ومن استخراج اسم الصنف — بتتقارن بعد توحيد الألف زي بالظبط مفتاح المخزون.
var GENERIC_QUERY_WORDS_ = ['عرض','اعرض','اعرضلي','اعرضها','عروض','غالي','غاليه','رخيص','ارخص','اقتصادي','اقتصاديه','بديل','البديل','بدايل','حاجه','حاجة','زيه','زيها','زي','تاني','ايه','لا','تمام','ماشي','اه','ايوه','اوكي','شكرا','خلاص','معلش','قصدي','دا','ده','دي'];
// كلمات منتجات من حرفين (بتتشال عادةً لأن الكلمات القصيرة ملهاش لازمة) — "في رز طيب؟" كانت بترجع بحث فاضي وتاخد اللي قبلها
var SHORT_PRODUCT_WORDS_ = ['رز','بن','خل'];
// "هيكل" الكلمة من غير حروف العلة: سيرلاك = سيريلاك ، برفلجان = بيرفالجان (الألف بتتشال من stockKey_ قبل كده)
function skel_(w) { return String(w).replace(/[يو]/g, ''); }
var GENERIC_KEYS_ = null;
function isGenericWord_(w) {
  if (!GENERIC_KEYS_) {
    GENERIC_KEYS_ = {};
    GENERIC_QUERY_WORDS_.forEach(function (g) { GENERIC_KEYS_[stockKey_(g)] = true; });
  }
  return GENERIC_KEYS_[w] === true || GENERIC_KEYS_[stockKey_(w)] === true;
}

// بيقرا أعمدة المخزون المطلوبة بس (أسرع)، بالاسم مش بالرقم
function readStockRowsFresh_() {
  const ss = SpreadsheetApp.openById(STOCK_SHEET_ID);
  const sheet = ss.getSheets()[0];
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = {};
  header.forEach(function(h, i) { idx[String(h || '').trim().toLowerCase()] = i; });

  const need = ['nameen','namear','price','stock','expire','units','activecomponent'];
  for (var i = 0; i < need.length; i++) {
    if (idx[need[i]] === undefined) {
      Logger.log('عمود ناقص في شيت المخزون: ' + need[i]);
      return [];
    }
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  const today = new Date();
  const out = [];

  for (var r = 0; r < data.length; r++) {
    const row = data[r];
    const stock = parseFloat(row[idx['stock']]) || 0;
    if (stock <= 0) continue;

    const nameAr = invCleanName_(row[idx['namear']]);
    const nameEn = invCleanName_(row[idx['nameen']]);
    const name = nameAr || nameEn;
    if (!name) continue;

    var daysToExpire = null;
    const expD = invParseDate_(row[idx['expire']], 'Africa/Cairo');
    if (expD) daysToExpire = Math.floor((expD - today) / 86400000);

    out.push({
      name: name,
      price: parseFloat(row[idx['price']]) || 0,
      stock: stock,
      units: parseFloat(row[idx['units']]) || 0,
      daysToExpire: daysToExpire,
      key: stockKey_(name + ' ' + nameEn),
      activeKey: stockKey_(row[idx['activecomponent']])
    });
  }
  return out;
}

// بنحتفظ بنسخة من المخزون في الذاكرة عشان منقراش الشيت مع كل رسالة.
// الشيت كبير (آلاف الصفوف) فقراءته كل مرة كانت بتاخد ثواني.
function readStockRows_() {
  try {
    const cache = CacheService.getScriptCache();
    const meta = cache.get('stk_meta');
    if (meta) {
      const n = parseInt(meta);
      const keys = [];
      for (var i = 0; i < n; i++) keys.push('stk_' + i);
      const parts = cache.getAll(keys);
      var joined = '';
      var ok = true;
      for (var j = 0; j < n; j++) {
        if (parts['stk_' + j] === undefined) { ok = false; break; }
        joined += parts['stk_' + j];
      }
      if (ok && joined) return JSON.parse(joined);
    }
  } catch (e) { /* الكاش وقع، هنقرا من الشيت عادي */ }

  const rows = readStockRowsFresh_();
  try {
    const json = JSON.stringify(rows);
    const CHUNK = 90000;
    const n = Math.ceil(json.length / CHUNK);
    const obj = {};
    for (var k = 0; k < n; k++) obj['stk_' + k] = json.substring(k * CHUNK, (k + 1) * CHUNK);
    const cache = CacheService.getScriptCache();
    cache.putAll(obj, STOCK_CACHE_MINUTES * 60);
    cache.put('stk_meta', String(n), STOCK_CACHE_MINUTES * 60);
  } catch (e) { /* عادي */ }
  return rows;
}

// لو حبيت تجبر تحديث المخزون فورًا بعد ما يتغير
function clearStockCache() {
  const cache = CacheService.getScriptCache();
  const meta = cache.get('stk_meta');
  if (meta) {
    const keys = ['stk_meta'];
    for (var i = 0; i < parseInt(meta); i++) keys.push('stk_' + i);
    cache.removeAll(keys);
  }
  Logger.log('✅ اتمسحت نسخة المخزون المحفوظة');
}

/* أشكال دوائية: لو العميل طلب "نقط" والمتوفر "شراب" من نفس الاسم/الماركة، ده تطابق قريب.
   ماركة تانية بنفس المادة الفعالة مش تطابق — البديل قرار الدكتور ومش بيتقال للعميل. */
var FORM_WORD_LIST_ = ['drops','drop','syrup','syr','tabs','tab','tablet','tablets','cap','caps','capsule','capsules','cream','ointment','oint','spray','gel','susp','suspension','amp','ampoule','ampule','vial','sachet','suppository','نقط','نقطة','قطرة','قطرات','شراب','أقراص','اقراص','قرص','حبوب','حبة','حبه','كبسول','كبسولة','كبسولات','كريم','مرهم','بخاخ','جل','لبوس','لبوسة','تحاميل','تحميلة','حقن','حقنة','أمبول','امبول','فيال','كيس','أكياس','معلق'];
var FORM_KEYS_ = null;
function isFormWord_(w) {
  if (!FORM_KEYS_) {
    FORM_KEYS_ = {};
    FORM_WORD_LIST_.forEach(function (g) { FORM_KEYS_[stockKey_(g)] = true; FORM_KEYS_[normalizeArabic(g)] = true; });
  }
  if (!w) return false;
  return FORM_KEYS_[w] === true || FORM_KEYS_[stockKey_(w)] === true || FORM_KEYS_[normalizeArabic(w)] === true;
}
/* أسماء مواد فعالة بالعربي والإنجليزي — سهل التوسيع. من غير أسماء تجارية عشان الماركة متبقاش "نفس المادة" بالغلط */
var ING_ALIAS_GROUPS_ = [
  ['simethicone', 'سيميثيكون', 'سميثيكون', 'سيميتيكون', 'سيميتكون'],
  ['paracetamol', 'باراسيتامول', 'اسيتامينوفين', 'acetaminophen'],
  ['ibuprofen', 'ايبوبروفين', 'ايبوبروفن'],
  ['diclofenac', 'ديكلوفيناك'],
  ['amoxicillin', 'اموكسيسيلين', 'أموكسيسيلين'],
  ['omeprazole', 'اوميبرازول', 'أوميبرازول'],
  ['pantoprazole', 'بانتوبرازول'],
  ['metformin', 'ميتفورمين'],
  ['atorvastatin', 'اتورفاستاتين'],
  ['cetirizine', 'سيتريزين'],
  ['loratadine', 'لوراتادين'],
  ['domperidone', 'دومبيريدون'],
  ['hyoscine', 'هيوسين'],
  ['salbutamol', 'سالبيوتامول'],
  ['metoclopramide', 'ميتوكلوبراميد'],
  ['lactulose', 'لاكتولوز', 'لاكتيولوز'],
  ['ambroxol', 'امبروكسول'],
  ['azithromycin', 'ازيثرومايسين'],
  ['ciprofloxacin', 'سيبروفلوكساسين'],
  ['metronidazole', 'ميترونيدازول']
];
var ING_ALIAS_INDEX_ = null;
function ingAliasKeys_(word) {
  if (!ING_ALIAS_INDEX_) {
    ING_ALIAS_INDEX_ = {};
    ING_ALIAS_GROUPS_.forEach(function (g) {
      var keys = [];
      g.forEach(function (n) { var k = stockKey_(n); if (k && keys.indexOf(k) === -1) keys.push(k); });
      keys.forEach(function (k) { ING_ALIAS_INDEX_[k] = keys; });
    });
  }
  var k = stockKey_(word);
  return (k && ING_ALIAS_INDEX_[k]) || (k ? [k] : []);
}
function wordHitsName_(word, it) {
  var toks = String(it.key || '').split(' ').filter(Boolean);
  var keys = ingAliasKeys_(word), sk = skel_(stockKey_(word));
  for (var i = 0; i < keys.length; i++) {
    var qw = keys[i];
    if (qw.length < 4) continue;
    for (var t = 0; t < toks.length; t++) {
      if (toks[t] === qw) return true;
      if (qw.length >= 5 && (toks[t].indexOf(qw) === 0 || qw.indexOf(toks[t]) === 0)) return true;
    }
  }
  if (sk.length >= 4) {
    for (var t2 = 0; t2 < toks.length; t2++) if (skel_(toks[t2]) === sk) return true;
  }
  return false;
}
function formWordHits_(formWord, it) {
  var qw = stockKey_(formWord);
  if (!qw) return false;
  var toks = String(it.key || '').split(' ').filter(Boolean);
  for (var i = 0; i < toks.length; i++) {
    var tok = toks[i];
    if (tok === qw) return true;
    if (qw.length >= 4 && tok.indexOf(qw) === 0) return true;
    if (tok.length >= 4 && qw.indexOf(tok) === 0) return true;
  }
  return false;
}
function withClose_(it, why, askedForm) {
  var c = {};
  for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) c[k] = it[k];
  c.closeMatch = true;
  c.closeWhy = why || 'partial';
  c.askedForm = askedForm || '';
  return c;
}
function askedFormWords_(query) {
  return normalizeArabic(query).split(' ').filter(function (w) { return isFormWord_(w); });
}
function tagFormMismatch_(items, query) {
  var forms = askedFormWords_(query);
  if (!forms.length) return items;
  var label = forms.join(' ');
  return items.map(function (it) {
    if (it.closeMatch) return it;
    var miss = forms.some(function (f) { return !formWordHits_(f, it); });
    return miss ? withClose_(it, 'form', label) : it;
  });
}
/* طبقة تانية بس لو مفيش تطابق قوي: نفس المنتج (الاسم/الماركة) بشكل تاني. من غير بدائل بنفس المادة. */
function closeStockMatches_(rows, qWords, askedForm) {
  var subst = [], forms = [];
  qWords.forEach(function (w) { (isFormWord_(w) ? forms : subst).push(w); });
  if (!subst.length) return [];
  if (!askedForm) askedForm = forms.join(' ');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var it = rows[i];
    if (it.daysToExpire !== null && it.daysToExpire < MIN_EXPIRY_DAYS_TO_OFFER) continue;
    var nameHits = [], misses = [];
    for (var s = 0; s < subst.length; s++) {
      if (wordHitsName_(subst[s], it)) nameHits.push(subst[s]);
      else misses.push(subst[s]);
    }
    /* كلمة مش في الاسم = مش نفس المنتج، حتى لو المادة الفعالة واحدة */
    if (!nameHits.length || misses.length) continue;
    var longest = subst.slice().sort(function (a, b) { return b.length - a.length; })[0];
    if (nameHits.indexOf(longest) === -1 && longest.length >= 6) continue;
    var formMiss = forms.some(function (f) { return !formWordHits_(f, it); });
    var why = formMiss ? 'form' : '';
    out.push({ item: it, score: nameHits.length * 100, why: why });
  }
  out.sort(function (a, b) { return b.score - a.score; });
  var seen = {}, res = [];
  for (var j = 0; j < out.length && res.length < MAX_RESULTS_TO_SHOW; j++) {
    if (seen[out[j].item.name]) continue;
    seen[out[j].item.name] = 1;
    res.push(out[j].why ? withClose_(out[j].item, out[j].why, askedForm) : out[j].item);
  }
  return res;
}

// البحث الأساسي — بيرجع نتايج مرتبة بالأهمية
// الفكرة: بنقارن كل كلمة في سؤال العميل بكل كلمة في اسم الصنف،
// وبندي درجة أعلى للتطابق الكامل. كده "بنادول" بتوصل لـ"بانادول"
// من غير ما تجيب "باندولين" (حفاضات) معاها.
function searchStock(query) {
  try {
    const rows = readStockRows_();
    if (!rows.length) return [];

    const qKey = stockKey_(query);
    if (!qKey) return [];

    const qWords = qKey.split(' ').filter(function(w) {
      return w.length >= 2 && STOP_WORDS_.indexOf(w) === -1 && !isGenericWord_(w);
    });
    if (!qWords.length) return [];

    const qSk = qWords.map(skel_);
    const scored = [];
    for (var i = 0; i < rows.length; i++) {
      const it = rows[i];
      const toks = it.key.split(' ').filter(function(t){ return t; });
      var score = 0, hit = 0;

      if (qKey.length >= 3 ? it.key.indexOf(qKey) !== -1 : toks.indexOf(qKey) !== -1) score += 60;   // العبارة كلها موجودة

      for (var w = 0; w < qWords.length; w++) {
        const qw = qWords[w];
        var best = 0;
        for (var t = 0; t < toks.length; t++) {
          const tok = toks[t];
          if (tok === qw) best = Math.max(best, 40);                                   // تطابق تام
          else if (qw.length >= 3 && tok.indexOf(qw) === 0) best = Math.max(best, Math.round(40 * qw.length / tok.length)); // بداية الكلمة
          else if (qw.length >= 3 && tok.indexOf(qw) !== -1) best = Math.max(best, Math.round(28 * qw.length / tok.length));
        }
        if (best === 0 && qSk[w].length >= 3) {   // اختلاف إملاء بسيط (سيرلاك/سيريلاك): بنقارن من غير ي و و
          for (var t2 = 0; t2 < toks.length; t2++) {
            const ts = skel_(toks[t2]);
            if (ts === qSk[w]) best = Math.max(best, 34);
            else if (qSk[w].length >= 4 && ts.indexOf(qSk[w]) === 0) best = Math.max(best, Math.round(30 * qSk[w].length / ts.length));
          }
        }
        /* المادة الفعالة لوحدها مش تطابق للعميل: ماركة تانية بنفس المادة بديل، والدكتور هو اللي يعرضه */
        if (best > 0) hit++;
        score += best;
      }
      if (!hit) continue;

      if (hit === qWords.length) score += 25;
      if (it.stock >= 1) score += 8;
      if (it.daysToExpire !== null && it.daysToExpire < MIN_EXPIRY_DAYS_TO_OFFER) score -= 60;

      scored.push({ item: it, score: score, hit: hit });
    }
    var formLabel = askedFormWords_(query).join(' ');
    if (!scored.length) return closeStockMatches_(rows, qWords, formLabel);

    // لو فيه نتايج طابقت كل الكلمات، منعرضش غيرها
    const full = scored.filter(function(x){ return x.hit === qWords.length; });
    const pool = full.length ? full : scored;

    pool.sort(function(a, b) { return b.score - a.score; });

    // درجة ضعيفة = مفيش تطابق حقيقي. قبل ما نقول "مش متوفر" ندوّر على نفس المنتج بشكل تاني بس
    if (pool[0].score < MIN_MATCH_SCORE) return closeStockMatches_(rows, qWords, formLabel);

    const cutoff = pool[0].score * 0.6;
    return tagFormMismatch_(pool.filter(function(x){ return x.score >= cutoff; })
               .slice(0, 8)
               .map(function(x){ return x.item; }), query);
  } catch (e) {
    Logger.log('خطأ searchStock: ' + e.message);
    return [];
  }
}

// ===================================================================
// 4) بناء الرد من البيانات — الأسعار من هنا بس
// ===================================================================

function formatItemLine_(it) {
  var line = '• ' + it.name + ' — ' + Math.round(it.price) + ' جنيه';
  if (it.stock < LOW_STOCK_THRESHOLD) line += ' (كمية محدودة)';
  return line;
}

/* جملة العميل لما الاسم مش موجود. البديل مش بيتقترح؛ الدكتور هو اللي يقرر. */
var PRODUCT_MISSING_REPLY_ = 'مش متوفر حاليًا، تحب نوفّره ولا مستعجل والدكتور يعرض بديل؟';

// بيرجع {text, prices[]} — prices هي الأرقام المسموح للمودل يذكرها
function buildProductAnswer_(results, askedFor) {
  const offerable = (results || []).filter(function(it) {
    if (it.closeMatch && it.closeWhy !== 'form') return false;
    return it.daysToExpire === null || it.daysToExpire >= MIN_EXPIRY_DAYS_TO_OFFER;
  });

  if (!offerable.length) {
    return {
      available: false,
      text: PRODUCT_MISSING_REPLY_,
      prices: [],
      items: []
    };
  }

  const show = offerable.slice(0, MAX_RESULTS_TO_SHOW);
  const prices = show.map(function(it){ return Math.round(it.price); });

  var text;
  var closeOnly = show.every(function (it) { return it.closeMatch && it.closeWhy === 'form'; });
  if (closeOnly) {
    var head = 'الشكل اللي حضرتك طلبته' + (show[0].askedForm ? ' (' + show[0].askedForm + ')' : '') + ' مش ظاهر عندي، المتوفر:';
    text = head + '\n' + show.map(formatItemLine_).join('\n');
    if (show.length > 1) text += '\n\nتحب أجهز لحضرتك أنهي واحد فيهم؟';
  } else if (show.length === 1) {
    const it = show[0];
    text = 'متوفر عندنا:\n' + formatItemLine_(it);
    if (it.units > 1) text += '\nالعلبة ' + it.units + ' ' + (it.units > 10 ? 'حبة' : 'وحدة');
  } else {
    text = 'عندنا الأنواع دي متوفرة دلوقتي:\n' + show.map(formatItemLine_).join('\n') +
           '\n\nتحب أجهز لحضرتك أنهي واحد فيهم؟';
  }
  return { available: true, text: text, prices: prices, items: show };
}