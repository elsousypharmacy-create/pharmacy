// ==== MODULE 72_scan (split from server/Code.js; load order = file name order) ====


// ═══════════════════════════════════════════════════════════════════
// 📷 الجرد بالكاميرا — نسخة "هاند هيلد"
//
// إزاي اشتغلت الفكرة (اتأكدنا منها من ملصقات حقيقية):
//   • كل علبة عليها ملصق فيه باركود Code128-C = 8 أرقام
//   • الـ8 أرقام دي = عمود "code" في شيت المخزون (مش gtin)
//   • ⚠️ الملصق مفيهوش تاريخ صلاحية — علبتين بصلاحيتين مختلفتين
//     بيلبسوا نفس الملصق بالظبط. فالماسحة بتعرف الصنف مش الدفعة.
//
// عشان كده: الموظف يعدّي بسرعة، والشاشة توقف بس لو الصنف له أكتر
// من صلاحية مسجلة — ساعتها يوزّع الكمية بنفسه.
//
// 🔒 الجرد بيطلع تقرير بس — مبيكتبش أي حاجة في المخزون.
// ═══════════════════════════════════════════════════════════════════

var COUNT_SESSIONS_SHEET = 'جلسات الجرد';
var COUNT_LINES_SHEET    = 'سطور الجرد';

/* خريطة {كود الصيدلية: الصنف} — الأساس اللي الماسحة بتشتغل عليه.
   كاش نص ساعة: المخزون مبيتغيرش بالسرعة دي والجرد بياخد ساعات. */
function scanIndex_() {
  var hit = fxCacheGet_('fx_scan_index');
  if (hit) return hit;

  var sh = SpreadsheetApp.openById(STOCK_SHEET_ID).getSheets()[0];
  if (!sh || sh.getLastRow() <= 1) return {};
  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var ix = {};
  hdr.forEach(function (h, i) { ix[String(h || '').trim().toLowerCase()] = i; });
  if (ix['code'] === undefined) return {};
  var hasUnits = ix['units'] !== undefined;

  /* getDisplayValues مش getValues — عشان الأكواد متتحولش لأرقام
     وتتكسر بفواصل الآلاف زي ما حصل مع gtin. */
  var d = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getDisplayValues();
  var map = {};

  d.forEach(function (r) {
    var code = String(r[ix['code']] || '').replace(/[^\d]/g, '');
    if (!code) return;

    var stock = parseFloat(String(r[ix['stock']]).replace(/,/g, '')) || 0;
    var price = parseFloat(String(r[ix['price']]).replace(/,/g, '')) || 0;

    /* الدفعات: multistock و multiexpire قوايم متوازية مفصولة بفاصلة */
    var batches = [];
    var mEx = String(r[ix['multiexpire']] || '').trim();
    var mSt = String(r[ix['multistock']]  || '').trim();
    if (mEx) {
      var ex = mEx.split(','), st = mSt ? mSt.split(',') : [];
      for (var i = 0; i < ex.length; i++) {
        var e = String(ex[i]).trim();
        if (!e || e === '0') continue;
        batches.push({ expire: e.substring(0, 10),
                       stock: parseFloat(String(st[i] || '').trim()) || 0 });
      }
    }
    if (!batches.length) {
      var one = String(r[ix['expire']] || '').trim().substring(0, 10);
      batches.push({ expire: (one && one !== '0') ? one : '', stock: stock });
    }

    /* عدد الأجزاء في العلبة (شرايط/أكياس/أمبولات).
       الرصيد متخزن بالعلبة، فـ0.9 في صنف units=10 معناها 9 أكياس.
       الموظف بيعدّ بالجزء والنظام بيحوّل — أنضف من إنه يكتب كسور. */
    var units = hasUnits
      ? (parseFloat(String(r[ix['units']] || '').replace(/,/g, '')) || 1) : 1;
    if (units < 1) units = 1;

    map[code] = {
      code: code,
      name: invCleanName_(r[ix['namear']]) || invCleanName_(r[ix['nameen']]) || 'صنف',
      price: price,
      stock: stock,
      units: units,
      cat: String(r[ix['category']] || '').trim(),
      batches: batches,
      multi: batches.length > 1        // ← ده اللي بيخلي الشاشة توقف
    };
  });

  fxCachePut_('fx_scan_index', map, 1800);
  return map;
}

function refreshScanIndex() {
  fxClearCache_('fx_scan_index');
  var m = scanIndex_();
  var n = Object.keys(m).length, multi = 0;
  Object.keys(m).forEach(function (k) { if (m[k].multi) multi++; });
  Logger.log('✅ اتحدّثت: ' + n + ' صنف · ' + multi + ' منهم بأكتر من صلاحية');
  return { ok: true, items: n, multi: multi };
}

/* بحث بالكود — بيتنادى مع كل مسحة */
function scanLookup(code) {
  try {
    var c = String(code || '').replace(/[^\d]/g, '');
    if (!c) return { ok: false, error: 'كود فاضي' };
    var m = scanIndex_();
    var it = m[c];
    if (!it) {
      /* أحيانًا الماسحة بتزود صفر في الأول أو تشيله */
      it = m[c.replace(/^0+/, '')] || m['0' + c];
    }
    if (!it) return { ok: true, found: false, code: c };
    return { ok: true, found: true, item: it };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* بحث بالاسم — للأصناف اللي ملصقها ضايع أو مقروش */
function scanSearch(q) {
  try {
    var needle = normalizeArabic(q || '');
    if (needle.length < 2) return { ok: true, results: [] };
    var m = scanIndex_(), out = [];
    Object.keys(m).forEach(function (k) {
      if (out.length >= 25) return;
      if (normalizeArabic(m[k].name).indexOf(needle) !== -1) out.push(m[k]);
    });
    return { ok: true, results: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}