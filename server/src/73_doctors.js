// ==== MODULE 73_doctors (split from server/Code.js; load order = file name order) ====


// ═══════════════════════════════════════════════════════════════════
// 🩺 بحث الدكاترة في المخزون — صفحة doctors.html
//
// • كل دكتور له كود خاص في شيت "الدكاترة" (كود | الاسم | التخصص | فعّال | آخر دخول).
//   إضافة دكتور = سطر جديد. إيقافه = اكتب "لا" في عمود فعّال.
// • بيرجّع بس: الاسم · المادة الفعالة · التصنيف · السعر · الحالة. مفيش تكلفة ولا كميات.
// • بحث تقريبي: لو في غلطة إملائية بيدوّر على أقرب أسماء.
// • الدكتور يقدر يجمّع أصناف في قائمة ويبعتها → شيت "طلبات الدكاترة" + تليجرام.
// • أي بحث مفيهوش صنف متوفر بيتسجل في شيت "بحث الدكاترة".
// ═══════════════════════════════════════════════════════════════════
var DOCTORS_SHEET = 'الدكاترة';
var DOCTOR_LOG_SHEET = 'بحث الدكاترة';
var DOCTOR_ORDERS_SHEET = 'طلبات الدكاترة';

function doctorNorm_(s) {
  return normalizeArabic(String(s || '')).toLowerCase().replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
}

/* بيرجّع {name, spec, row} للدكتور أو null. الكاش 5 دقايق. */
function doctorAuth_(key, touch) {
  var k = String(key || '').trim().toUpperCase();
  if (!k) return null;
  var cache = CacheService.getScriptCache();
  var map = null;
  try { var raw = cache.get('doc_map'); if (raw) map = JSON.parse(raw); } catch (e) {}
  if (!map) {
    map = {};
    var sh = getOrCreateSheet_(DOCTORS_SHEET, ['الكود', 'الاسم', 'التخصص', 'فعّال', 'آخر دخول']);
    var d = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues() : [];
    d.forEach(function (r, i) {
      var c = String(r[0] || '').trim();
      if (!c || /^(لا|no|n|0|false)$/i.test(String(r[3] || '').trim())) return;
      map[c.toUpperCase()] = { name: String(r[1] || '').trim() || 'دكتور', spec: String(r[2] || '').trim(), row: i + 2 };
    });
    cache.put('doc_map', JSON.stringify(map), 300);
  }
  var doc = map[k];
  if (!doc) return null;
  if (touch) {
    try {
      getOrCreateSheet_(DOCTORS_SHEET, []).getRange(doc.row, 5)
        .setValue(Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'));
    } catch (e) {}
  }
  return doc;
}

function doctorGate_(key, touch) {
  var cache = CacheService.getScriptCache();
  var fails = parseInt(cache.get('doc_fail') || '0', 10);
  if (fails >= 40) return { err: { ok: false, error: 'locked', msg: 'محاولات كتير — جرّب بعد شوية' } };
  var doc = doctorAuth_(key, touch);
  if (!doc) {
    cache.put('doc_fail', String(fails + 1), 600);
    return { err: { ok: false, error: 'bad_code', msg: 'الكود غلط' } };
  }
  return { doc: doc };
}

function doctorIndex_() {
  var hit = fxCacheGet_('fx_doc_index');
  if (hit) return hit;
  var sh = SpreadsheetApp.openById(STOCK_SHEET_ID).getSheets()[0];
  if (!sh || sh.getLastRow() <= 1) return [];
  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var ix = {};
  hdr.forEach(function (h, i) { ix[String(h || '').trim().toLowerCase()] = i; });
  var d = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getDisplayValues();
  var out = [];
  d.forEach(function (r) {
    var name = invCleanName_(r[ix['namear']]) || invCleanName_(r[ix['nameen']]);
    if (!name) return;
    var en = invCleanName_(r[ix['nameen']]) || '';
    var active = String(r[ix['activecomponent']] || '').trim();
    var stock = parseFloat(String(r[ix['stock']]).replace(/,/g, '')) || 0;
    var price = parseFloat(String(r[ix['price']]).replace(/,/g, '')) || 0;
    out.push({
      n: name, e: en, a: active, c: String(r[ix['category']] || '').trim(),
      p: price, s: stock,
      h: doctorNorm_(name + ' ' + en + ' ' + active),
      k: doctorNorm_(active).replace(/[^a-z؀-ۿ+ ]/g, '').trim()
    });
  });
  fxCachePut_('fx_doc_index', out, 1800);
  return out;
}

function doctorStatus_(stock) {
  if (stock <= 0) return 'out';
  if (stock < 2) return 'low';
  return 'ok';
}

/* مسافة التعديل بين كلمتين (بتقف بدري لو عدّت الحد) */
function doctorLev_(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    var rowMin = i;
    for (j = 1; j <= b.length; j++) {
      var c = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/* درجة التقارب لصنف: مجموع أصغر مسافة لكل كلمة بحث. null = بعيد */
function doctorFuzzyScore_(it, toks) {
  var words = it.h.split(' '), total = 0;
  for (var t = 0; t < toks.length; t++) {
    var tk = toks[t], allow = tk.length >= 7 ? 2 : (tk.length >= 4 ? 1 : 0), best = 99;
    if (it.h.indexOf(tk) !== -1) { best = 0; }
    else if (allow) {
      for (var w = 0; w < words.length && best > 0; w++) {
        var wd = words[w];
        if (!wd) continue;
        best = Math.min(best, doctorLev_(tk, wd, allow), doctorLev_(tk, wd.substring(0, tk.length), allow));
      }
    }
    if (best > allow) return null;
    total += best;
  }
  return total;
}

function doctorSearch(q, key) {
  try {
    var g = doctorGate_(key, q === '__check');
    if (g.err) return g.err;
    if (q === '__check') return { ok: true, results: [], doctor: g.doc.name, spec: g.doc.spec };
    var needle = doctorNorm_(q);
    if (needle.length < 2) return { ok: true, results: [] };
    var toks = needle.split(' ').filter(Boolean);
    var idx = doctorIndex_();
    var exact = idx.filter(function (it) {
      return toks.every(function (t) { return it.h.indexOf(t) !== -1; });
    });
    var sorter = function (a, b) {
      var sa = a.s > 0 ? 0 : 1, sb = b.s > 0 ? 0 : 1;
      return sa - sb || (a.n < b.n ? -1 : 1);
    };
    exact.sort(sorter);
    var hits = exact, fuzzy = false;
    if (exact.length < 5) {
      var seen = {}, extra = [];
      exact.forEach(function (it) { seen[it.n + '|' + it.p] = 1; });
      idx.forEach(function (it) {
        if (seen[it.n + '|' + it.p]) return;
        var sc = doctorFuzzyScore_(it, toks);
        if (sc !== null) extra.push({ it: it, sc: sc });
      });
      extra.sort(function (a, b) { return a.sc - b.sc || sorter(a.it, b.it); });
      if (extra.length) {
        fuzzy = !exact.length;
        hits = exact.concat(extra.slice(0, 15).map(function (x) { return x.it; }));
      }
    }
    var total = hits.length;
    hits = hits.slice(0, 40);
    var results = hits.map(function (it) {
      var st = doctorStatus_(it.s), alts = [];
      if (st === 'out' && it.k) {
        for (var i = 0; i < idx.length && alts.length < 3; i++) {
          var o = idx[i];
          if (o !== it && o.s > 0 && o.k === it.k) alts.push({ n: o.n, p: o.p, st: doctorStatus_(o.s) });
        }
      }
      return { n: it.n, e: it.e, a: it.a, c: it.c, p: it.p, st: st, alts: alts };
    });
    var anyAvail = results.some(function (r) { return r.st !== 'out'; });
    if (!anyAvail) {
      try {
        var lg = getOrCreateSheet_(DOCTOR_LOG_SHEET, ['التاريخ', 'الدكتور', 'البحث', 'النتيجة']);
        lg.appendRow([Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'), g.doc.name,
                      String(q).substring(0, 80), total ? 'غير متوفر' : 'مش في المخزون']);
      } catch (e2) {}
    }
    return { ok: true, results: results, total: total, fuzzy: fuzzy };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* الدكتور بيبعت قائمة أصناف للصيدلية. items = JSON [{n, q}] */
function doctorOrder(itemsJson, note, key) {
  try {
    var g = doctorGate_(key, false);
    if (g.err) return g.err;
    var items = JSON.parse(itemsJson || '[]');
    if (!Array.isArray(items) || !items.length) return { ok: false, msg: 'القائمة فاضية' };
    items = items.slice(0, 30).map(function (x) {
      return { n: String(x.n || '').substring(0, 80), q: Math.max(1, Math.min(99, parseInt(x.q, 10) || 1)) };
    });
    var cache = CacheService.getScriptCache();
    var ck = 'doc_ord_' + g.doc.row;
    var cnt = parseInt(cache.get(ck) || '0', 10);
    if (cnt >= 10) return { ok: false, msg: 'وصلت الحد المسموح، كلّم الصيدلية' };
    cache.put(ck, String(cnt + 1), 3600);

    var text = items.map(function (x) { return x.n + ' × ' + x.q; }).join('\n');
    var nt = String(note || '').substring(0, 300);
    var stamp = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm');
    getOrCreateSheet_(DOCTOR_ORDERS_SHEET, ['التاريخ', 'الدكتور', 'الأصناف', 'ملاحظة', 'الحالة'])
      .appendRow([stamp, g.doc.name, text, nt, 'جديد']);
    try {
      /* حالة كل صنف دلوقتي في المخزون عشان الفريق يعرف يجهّز إيه */
      var st = {};
      try { doctorIndex_().forEach(function (it) { st[it.n] = it.s; }); } catch (e4) {}
      var lines = items.map(function (x) {
        var sv = st[x.n];
        var mark = sv === undefined ? '' : (sv > 0 ? '✅ ' : '❌ ');
        return mark + x.n + ' × ' + x.q;
      }).join('\n');
      var msg = '🩺 طلب جديد من د. ' + g.doc.name + (g.doc.spec ? ' (' + g.doc.spec + ')' : '') +
        '\n' + lines + (nt ? '\n📝 ' + nt : '') + '\n\n✅ متوفر · ❌ غير متوفر';
      sendTelegramStaff(msg, STAFF_GROUP);
      sendTelegramStaff(msg, PERSONAL_CHAT);
    } catch (e3) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}


/* ===== إدارة الدكاترة من الداشبورد (تبويب "دكاترة") ===== */
function doctorGenCode_() {
  var ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', c = 'D';
  for (var i = 0; i < 5; i++) c += ch.charAt(Math.floor(Math.random() * ch.length));
  return c;
}

function doctorAdmin(p) {
  try {
    var op = String(p.op || 'list');
    var sh = getOrCreateSheet_(DOCTORS_SHEET, ['الكود', 'الاسم', 'التخصص', 'فعّال', 'آخر دخول']);
    var cache = CacheService.getScriptCache();
    var rowNo = parseInt(p.row, 10) || 0;

    if (op === 'add') {
      var name = String(p.name || '').trim();
      if (!name) return { ok: false, msg: 'اكتب اسم الدكتور' };
      var code = String(p.code || '').trim().toUpperCase().replace(/\s+/g, '');
      var used = sh.getLastRow() > 1
        ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(function (r) { return String(r[0]).trim().toUpperCase(); })
        : [];
      if (!code) { do { code = doctorGenCode_(); } while (used.indexOf(code) !== -1); }
      else if (used.indexOf(code) !== -1) return { ok: false, msg: 'الكود ده مستخدم، اختار غيره' };
      sh.appendRow([code, name, String(p.spec || '').trim(), 'نعم', '']);
      cache.remove('doc_map');
      return { ok: true, code: code };
    }
    if (op === 'toggle') {
      if (rowNo < 2 || rowNo > sh.getLastRow()) return { ok: false, msg: 'سطر غلط' };
      var cur = String(sh.getRange(rowNo, 4).getDisplayValue()).trim();
      var off = /^(لا|no|n|0|false)$/i.test(cur);
      sh.getRange(rowNo, 4).setValue(off ? 'نعم' : 'لا');
      cache.remove('doc_map');
      return { ok: true, active: off };
    }
    if (op === 'done') {
      var osh = getOrCreateSheet_(DOCTOR_ORDERS_SHEET, ['التاريخ', 'الدكتور', 'الأصناف', 'ملاحظة', 'الحالة']);
      if (rowNo < 2 || rowNo > osh.getLastRow()) return { ok: false, msg: 'سطر غلط' };
      osh.getRange(rowNo, 5).setValue('تم');
      return { ok: true };
    }

    /* list */
    var docs = [];
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().forEach(function (r, i) {
        if (!String(r[0]).trim()) return;
        docs.push({ row: i + 2, code: String(r[0]).trim(), name: r[1], spec: r[2],
                    active: !/^(لا|no|n|0|false)$/i.test(String(r[3]).trim()), last: r[4] });
      });
    }
    var orders = [];
    var osh2 = getOrCreateSheet_(DOCTOR_ORDERS_SHEET, ['التاريخ', 'الدكتور', 'الأصناف', 'ملاحظة', 'الحالة']);
    var on = osh2.getLastRow() - 1;
    if (on > 0) {
      var from = Math.max(2, osh2.getLastRow() - 39);
      osh2.getRange(from, 1, osh2.getLastRow() - from + 1, 5).getDisplayValues().forEach(function (r, i) {
        orders.push({ row: from + i, at: r[0], doctor: r[1], items: r[2], note: r[3], status: r[4] });
      });
      orders.reverse();
    }
    var misses = [];
    var lsh = getOrCreateSheet_(DOCTOR_LOG_SHEET, ['التاريخ', 'الدكتور', 'البحث', 'النتيجة']);
    if (lsh.getLastRow() > 1) {
      var lf = Math.max(2, lsh.getLastRow() - 299), agg = {};
      lsh.getRange(lf, 1, lsh.getLastRow() - lf + 1, 4).getDisplayValues().forEach(function (r) {
        var k = doctorNorm_(r[2]); if (!k) return;
        var o = agg[k] || (agg[k] = { q: r[2], n: 0, last: '', result: r[3], doctors: {} });
        o.n++; o.last = r[0]; o.result = r[3]; if (r[1]) o.doctors[r[1]] = 1;
      });
      misses = Object.keys(agg).map(function (k) {
        var o = agg[k]; return { q: o.q, n: o.n, last: o.last, result: o.result, doctors: Object.keys(o.doctors).length };
      }).sort(function (a, b) { return b.n - a.n; }).slice(0, 20);
    }
    return { ok: true, doctors: docs, orders: orders, misses: misses };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}