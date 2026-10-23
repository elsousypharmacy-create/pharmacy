// ==== MODULE 75_count_shortage (split from server/Code.js; load order = file name order) ====


// ═══════════════════════════════════════════════════════════════════
// 📈 كفاءة الطلبيات — سجل النواقص
//
// النظام مبيحتفظش بتاريخ النواقص، فبنسجّله إحنا: كل ساعتين-تلاتة (مع لقطة
// الساعة) بناخد صورة من قايمة النواقص، وكل صنف بيتسجّل له "فترة نقص":
// أول ما ظهر → أول ما اختفى (اتطلب أو اتوفّر). من الفترات دي بنقيس:
//   • متوسط مدة بقاء الصنف ناقص
//   • الأصناف ناقصة من أكتر من 3 أيام (لسه مطلبتش)
//   • الأصناف اللي بتخلص بتكرار (حد الطلب واطي)
//   • عدد الناقص يوميًا (اتجاه)
// ⚠️ الأرقام بتبدأ تبقى مفهومة بعد 3-7 أيام من أول تسجيل.
// ═══════════════════════════════════════════════════════════════════
var SHORT_EP_SHEET = 'سجل النواقص';
var SHORT_DAILY_SHEET = 'سجل النواقص اليومي';
var SHORT_EP_HEAD = ['المفتاح', 'الصنف', 'القسم', 'الشركة', 'النوع', 'أول ظهور', 'آخر ظهور', 'الحالة',
                     'انتهى', 'المدة (ساعات)', 'أقصى كمية', 'أول ظهور ms', 'انتهى ms', 'بداية الصفر ms'];

function shortFmt_(ms) { return Utilities.formatDate(new Date(ms), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'); }

/* بيتأكد إن الشيت فيه كل الأعمدة (لو اتعمل بنسخة أقدم) */
function shortEpSheet_() {
  var sh = getOrCreateSheet_(SHORT_EP_SHEET, SHORT_EP_HEAD);
  if (sh.getMaxColumns() < SHORT_EP_HEAD.length) sh.insertColumnsAfter(sh.getMaxColumns(), SHORT_EP_HEAD.length - sh.getMaxColumns());
  if (String(sh.getRange(1, SHORT_EP_HEAD.length).getDisplayValue()) !== SHORT_EP_HEAD[SHORT_EP_HEAD.length - 1])
    sh.getRange(1, 1, 1, SHORT_EP_HEAD.length).setValues([SHORT_EP_HEAD]);
  return sh;
}

function logShortageSnapshot_(force) {
  var cache = CacheService.getScriptCache();
  if (!force && cache.get('short_log_t')) return { ok: true, skipped: true };

  var res = UrlFetchApp.fetch(SHORTAGE_SCRIPT_URL + '?action=getShortages&days=7', { muteHttpExceptions: true });
  var d = JSON.parse(res.getContentText());
  if (!d || d.error) return { ok: false, msg: 'مقدرتش أجيب النواقص' };

  var cur = {}, nZero = 0, nLow = 0;
  ['zero', 'low'].forEach(function (sec) {
    var data = d[sec];
    if (!data || !data.categories) return;
    Object.keys(data.categories).forEach(function (cat) {
      var comps = data.categories[cat];
      Object.keys(comps).forEach(function (co) {
        comps[co].forEach(function (it) {
          var k = String(it.code || it.name || '').trim();
          if (!k) return;
          var q = Math.ceil(Number(it.shortage) - 1e-9); if (!isFinite(q) || q < 1) q = 1;
          if (cur[k]) { if (sec === 'zero') cur[k].sec = 'zero'; cur[k].q = Math.max(cur[k].q, q); return; }
          cur[k] = { k: k, name: String(it.name || ''), cat: cat, co: co, sec: sec, q: q };
          if (sec === 'zero') nZero++; else nLow++;
        });
      });
    });
  });

  var sh = shortEpSheet_();
  var n = sh.getLastRow() - 1;
  var rows = n > 0 ? sh.getRange(2, 1, n, SHORT_EP_HEAD.length).getValues() : [];
  var now = new Date().getTime(), nowS = shortFmt_(now);
  var openCount = 0, seen = {};
  rows.forEach(function (r) { if (r[7] === 'قائم') openCount++; });

  /* حماية: قايمة فاضية فجأة مع نواقص كتير مفتوحة = غالبًا عطل مش حقيقة */
  var closeAllowed = !(Object.keys(cur).length === 0 && openCount > 5);

  rows.forEach(function (r) {
    if (r[7] !== 'قائم') return;
    var k = String(r[0]);
    if (cur[k]) {
      seen[k] = true;
      r[6] = nowS;
      if (cur[k].sec === 'zero') { r[4] = 'خلص خالص'; if (!Number(r[13])) r[13] = now; }
      r[10] = Math.max(Number(r[10]) || 0, cur[k].q);
    } else if (closeAllowed) {
      r[7] = 'انتهى'; r[8] = nowS; r[12] = now;
      r[9] = Math.round((now - Number(r[11])) / 360000) / 10;
    }
  });
  Object.keys(cur).forEach(function (k) {
    if (seen[k]) return;
    var c = cur[k];
    rows.push([k, c.name, c.cat, c.co, c.sec === 'zero' ? 'خلص خالص' : 'قرب يخلص', nowS, nowS, 'قائم', '', '', c.q, now, '',
               c.sec === 'zero' ? now : '']);
  });
  /* نشيل الفترات المنتهية الأقدم من 180 يوم */
  var cutoff = now - 180 * 86400000;
  rows = rows.filter(function (r) { return r[7] === 'قائم' || (Number(r[12]) || now) >= cutoff; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHORT_EP_HEAD.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, SHORT_EP_HEAD.length).setValues(rows);

  /* العدد اليومي: صف لكل يوم بيتحدّث بآخر لقطة */
  var dsh = getOrCreateSheet_(SHORT_DAILY_SHEET, ['التاريخ', 'خلص خالص', 'قرب يخلص']);
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var last = dsh.getLastRow();
  if (last > 1 && String(dsh.getRange(last, 1).getDisplayValue()).trim() === today) {
    dsh.getRange(last, 2, 1, 2).setValues([[nZero, nLow]]);
  } else dsh.appendRow([today, nZero, nLow]);

  cache.put('short_log_t', '1', 10200);   // ~2.8 ساعة
  try { salesVelocity_(); } catch (eV) { Logger.log('خطأ سرعة البيع: ' + eV.message); }   // يسخّن الكاش
  return { ok: true, zero: nZero, low: nLow, open: Object.keys(cur).length, closed: closeAllowed };
}

/* سرعة بيع كل صنف من ملفات المبيعات (آخر 28 يوم). بنستخدمها نقدّر المبيعات
   اللي ضاعت وقت ما الصنف كان خالص. الكاش 5.8 ساعة. */
function salesVelocity_() {
  var hit = fxCacheGet_('fx_sales_vel3');
  if (hit) return hit;
  var DAYS = 28, folder = DriveApp.getFolderById(SALES_FOLDER), tz = 'Africa/Cairo', now = new Date();
  var items = {}, filesRead = 0;
  for (var i = 0; i < DAYS; i++) {
    var ds = Utilities.formatDate(new Date(now.getTime() - i * 86400000), tz, 'yyyy-MM-dd');
    var it = folder.getFilesByName('sales' + ds + '.txt');
    if (!it.hasNext()) continue;
    var content = it.next().getBlob().getDataAsString('UTF-8');
    if (!content) continue;
    filesRead++;
    var rx = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
    while ((m = rx.exec(content)) !== null) {
      var tuples = extractTuples('(' + m[1] + ')');
      for (var t = 0; t < tuples.length; t++) {
        try {
          var v = parseValues(tuples[t]);
          if (!v || v.length < 50) continue;
          if ((v[2] ? v[2].trim() : '') !== 'sale') continue;
          var nm = doctorNorm_(v[6] || v[5] || '');
          var q = parseFloat(v[7]) || 0, p = parseFloat(v[8]) || 0;
          if (!nm || q <= 0) continue;
          var o = items[nm] || (items[nm] = { q: 0, r: 0 });
          o.q += q; o.r += q * p;
          var alt = doctorNorm_(v[5] || '');
          if (alt && alt !== nm && !items[alt]) items[alt] = o;   // نفس الكائن تحت اسم تاني
        } catch (e) { continue; }
      }
    }
  }
  /* الاسم البديل بيشاور لنفس الكائن — نجمع الإيراد مرة واحدة قبل ما النسخ تتفصل في الكاش */
  var rev = 0;
  Object.keys(items).forEach(function (k) {
    var o = items[k];
    if (!o || o._counted) return;
    o._counted = 1;
    rev += o.r || 0;
  });
  /* الكاش بيتخزن كنص — الكائنات المشتركة بتتفصل، فبنخزّن كل اسم بقيمته */
  var flat = {};
  Object.keys(items).forEach(function (k) { flat[k] = [Math.round(items[k].q * 100) / 100, Math.round(items[k].r)]; });
  var out = { days: DAYS, files: filesRead, items: flat, rev: Math.round(rev) };
  fxCachePut_('fx_sales_vel3', out, 20800);
  return out;
}

/* بيدوّر على الصنف في سرعة البيع: بالاسم بالظبط، وبعدين كل كلمات الاسم موجودة */
function velLookup_(vel, name) {
  if (!vel || !vel.items) return null;
  var nm = doctorNorm_(name);
  if (!nm) return null;
  if (vel.items[nm]) return vel.items[nm];
  var toks = nm.split(' ').filter(function (t) { return t.length >= 2; });
  if (!toks.length) return null;
  var best = null;
  Object.keys(vel.items).forEach(function (k) {
    if (toks.every(function (t) { return k.indexOf(t) !== -1; })) {
      if (!best || vel.items[k][0] > best[0]) best = vel.items[k];
    }
  });
  return best;
}

function orderEfficiency(days) {
  try {
    var dd = Math.max(3, Math.min(90, parseInt(days, 10) || 7));
    var now = new Date().getTime(), from = now - dd * 86400000;
    var sh = shortEpSheet_();
    var n = sh.getLastRow() - 1;
    var rows = n > 0 ? sh.getRange(2, 1, n, SHORT_EP_HEAD.length).getValues() : [];
    var firstMs = null;
    rows.forEach(function (r) { var f = Number(r[11]); if (f && (firstMs === null || f < firstMs)) firstMs = f; });

    var inP = rows.filter(function (r) { return r[7] === 'قائم' || (Number(r[12]) || 0) >= from; });
    var closed = inP.filter(function (r) { return r[7] === 'انتهى'; });
    var hrs = closed.map(function (r) { return Number(r[9]) || 0; }).sort(function (a, b) { return a - b; });
    var avg = hrs.length ? hrs.reduce(function (a, b) { return a + b; }, 0) / hrs.length : null;
    var med = hrs.length ? hrs[Math.floor(hrs.length / 2)] : null;

    var open = rows.filter(function (r) { return r[7] === 'قائم'; }).map(function (r) {
      return { name: r[1], co: r[3], type: r[4], hours: Math.round((now - Number(r[11])) / 360000) / 10, q: r[10] };
    }).sort(function (a, b) { return b.hours - a.hours; });
    var stale = open.filter(function (o) { return o.hours > 72; });

    var rep = {};
    inP.forEach(function (r) {
      var k = String(r[0]); var o = rep[k] || (rep[k] = { name: r[1], co: r[3], n: 0 });
      o.n++;
    });
    var repeat = Object.keys(rep).map(function (k) { return rep[k]; })
      .filter(function (o) { return o.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);

    var dsh = getOrCreateSheet_(SHORT_DAILY_SHEET, ['التاريخ', 'خلص خالص', 'قرب يخلص']);
    var dn = dsh.getLastRow() - 1, series = [];
    if (dn > 0) {
      series = dsh.getRange(Math.max(2, dsh.getLastRow() - dd + 1), 1, Math.min(dn, dd), 3).getDisplayValues()
        .map(function (r) { return { date: r[0], zero: Number(r[1]) || 0, low: Number(r[2]) || 0 }; });
    }
    var trend = null;
    if (series.length >= 4) {
      var h = Math.floor(series.length / 2);
      var a1 = series.slice(0, h).reduce(function (a, x) { return a + x.zero; }, 0) / h;
      var a2 = series.slice(h).reduce(function (a, x) { return a + x.zero; }, 0) / (series.length - h);
      trend = Math.round((a2 - a1) * 10) / 10;   // موجب = النواقص بتزيد
    }
    /* المبيعات الضايعة: أيام ما كان الصنف خالص (جوه الفترة) × متوسط بيعه اليومي × سعر البيع */
    var lost = { value: 0, units: 0, items: [], zeroEpisodes: 0, matched: 0, velFiles: 0 };
    try {
      var vel = salesVelocity_(); lost.velFiles = vel.files;
      var agg = {};
      inP.forEach(function (r) {
        var z = Number(r[13]); if (!z) return;
        lost.zeroEpisodes++;
        var end = r[7] === 'قائم' ? now : (Number(r[12]) || now);
        var daysOut = (end - Math.max(z, from)) / 86400000;
        if (daysOut <= 0) return;
        var v = velLookup_(vel, r[1]);
        if (!v) return;
        lost.matched++;
        var perDay = v[0] / vel.days, price = v[0] > 0 ? v[1] / v[0] : 0;
        var units = perDay * daysOut, value = units * price;
        var key = String(r[0]);
        var a = agg[key] || (agg[key] = { name: r[1], co: r[3], daysOut: 0, perDay: perDay, units: 0, value: 0 });
        a.daysOut += daysOut; a.units += units; a.value += value;
        lost.value += value; lost.units += units;
      });
      lost.items = Object.keys(agg).map(function (k) { var a = agg[k];
        return { name: a.name, co: a.co, daysOut: Math.round(a.daysOut * 10) / 10, perDay: Math.round(a.perDay * 10) / 10,
                 units: Math.round(a.units), value: Math.round(a.value) }; })
        .sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
      lost.value = Math.round(lost.value); lost.units = Math.round(lost.units);
    } catch (eL) { lost.error = eL.message; }
    var collectedDays = firstMs ? Math.floor((now - firstMs) / 86400000) : 0;
    return { ok: true, days: dd, collectedDays: collectedDays, since: firstMs ? shortFmt_(firstMs) : '',
             episodes: inP.length, closed: closed.length, avgHours: avg === null ? null : Math.round(avg * 10) / 10,
             medHours: med, openNow: open.length, stale: stale.length, oldest: open.slice(0, 10),
             repeat: repeat, series: series, trend: trend, lost: lost };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

/* حفظ الجرد. بيتبعت دفعة واحدة من الموبايل لما الموظف يدوس "خلّصت".
   بيتخزن محليًا على الموبايل قبل كده، فقطع النت مبيضيعش الشغل. */
function saveCountSession(payload) {
  try {
    var data = (typeof payload === 'string') ? JSON.parse(payload) : payload;
    var lines = data.lines || [];
    if (!lines.length) return { ok: false, error: 'الجرد فاضي' };

    var now = new Date();
    var stamp = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    var id = data.sessionId || ('J' + now.getTime());
    var who = String(data.by || '').trim();
    var title = String(data.title || 'جرد').trim();

    var idx = scanIndex_();
    var rows = [], diffCount = 0, diffValue = 0, counted = 0;

    lines.forEach(function (L) {
      var code = String(L.code || '').replace(/[^\d]/g, '');
      var it = idx[code] || null;
      var expire = String(L.expire || '').trim();
      var qty = parseFloat(L.qty) || 0;
      counted += qty;

      /* رصيد السيستم للدفعة دي تحديدًا — مش الصنف كله.
         لو الموبايل بعت الرصيد اللي كان قدامه وقت العدّ (من لقطة المخزون)
         بنستخدمه هو — لأن الرصيد وقت الحفظ ممكن يكون اتغيّر بالبيع
         وساعتها الفرق بيبقى وهمي. */
      var sys = 0;
      var hasClientSys = (L.sys !== undefined && L.sys !== null && L.sys !== '' &&
                          isFinite(parseFloat(L.sys)) && String(L.snapAt || '') !== '');
      if (hasClientSys) {
        sys = parseFloat(L.sys);
      } else if (it) {
        if (expire) {
          it.batches.forEach(function (b) { if (b.expire === expire) sys += b.stock; });
        } else {
          sys = it.stock;
        }
      }
      var diff = qty - sys;
      var price = it ? it.price : 0;
      if (Math.abs(diff) > 0.001) { diffCount++; diffValue += diff * price; }

      rows.push([
        stamp, id, title, who,
        code, it ? it.name : '⚠️ صنف مش معروف',
        expire || '—',
        sys, qty, diff,
        Math.round(diff * price * 100) / 100,
        it ? it.cat : '',
        L.isNewBatch ? 'صلاحية زيادة' : '',
        String(L.snapAt || '')          /* وقت لقطة الأرصدة اللي اتقارن بيها */
      ]);
    });

    var lsh = getOrCreateSheet_(COUNT_LINES_SHEET, [
      'الوقت','رقم الجلسة','العنوان','الموظف','الكود','الصنف',
      'الصلاحية','رصيد السيستم','العد الفعلي','الفرق','قيمة الفرق','الفئة','ملاحظة'
    ]);
    if (String(lsh.getRange(1, 14).getValue() || '') !== 'وقت اللقطة') lsh.getRange(1, 14).setValue('وقت اللقطة');
    lsh.getRange(lsh.getLastRow() + 1, 1, rows.length, 14).setValues(rows);

    var ssh = getOrCreateSheet_(COUNT_SESSIONS_SHEET, [
      'الوقت','رقم الجلسة','العنوان','الموظف','عدد السطور','إجمالي العلب','سطور فيها فرق','قيمة الفروقات'
    ]);
    ssh.appendRow([stamp, id, title, who, rows.length, counted, diffCount,
                   Math.round(diffValue * 100) / 100]);

    sendTelegramStaff(
      '📋 جرد جديد اتسجّل\n' + SEP + '\n' +
      'العنوان: ' + title + '\n' + (who ? ('الموظف: ' + who + '\n') : '') +
      'أصناف: ' + rows.length + ' · علب: ' + Math.round(counted) + '\n' +
      'فيها فرق: ' + diffCount + ' صنف\n' +
      'قيمة الفروقات: ' + Math.round(diffValue) + ' جنيه',
      PERSONAL_CHAT
    );

    removeOpenCount_(id);   // اتقفل خلاص، يتشال من الشغالة

    return { ok: true, sessionId: id, lines: rows.length,
             diffCount: diffCount, diffValue: Math.round(diffValue) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* تقرير جلسة — الفروقات مرتبة بالأغلى */
function getCountReport(sessionId) {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_LINES_SHEET);
    if (!sh || sh.getLastRow() <= 1) return { ok: true, lines: [] };
    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 13).getValues();
    var out = [];
    d.forEach(function (r) {
      if (sessionId && String(r[1]) !== String(sessionId)) return;
      out.push({
        code: String(r[4]), name: r[5], expire: r[6],
        sys: parseFloat(r[7]) || 0, counted: parseFloat(r[8]) || 0,
        diff: parseFloat(r[9]) || 0, diffValue: parseFloat(r[10]) || 0,
        cat: r[11], note: r[12]
      });
    });
    out.sort(function (a, b) { return Math.abs(b.diffValue) - Math.abs(a.diffValue); });
    return { ok: true, sessionId: sessionId || 'الكل', lines: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getCountSessions() {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_SESSIONS_SHEET);
    if (!sh || sh.getLastRow() <= 1) return { ok: true, sessions: [] };
    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
    var out = d.map(function (r) {
      return { at: r[0], id: String(r[1]), title: r[2], by: r[3],
               lines: r[4], units: r[5], diffCount: r[6], diffValue: r[7] };
    }).reverse();
    return { ok: true, sessions: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* 🩺 فحص جاهزية الجرد — شغّلها قبل ما تبدأ */
function diagnoseScanReady() {
  var m = scanIndex_();
  var codes = Object.keys(m);
  var inStock = 0, multi = 0, noExp = 0, batches = 0, bad = 0;

  /* ⚠️ النسبة بتتحسب على الأصناف اللي فيها رصيد بس.
     الأصناف الصفر معندهاش دفعات أصلاً، فلو حسبناها كانت هتنزّل
     النسبة كذب وتخلينا نبني تصميم غلط.

     ملحوظة: الأصناف الصفر بتفضل موجودة في خريطة المسح عن قصد —
     لو الموظف لقى على الرف صنف السيستم شايفه صفر، لازم الماسحة
     تعرفه وتسجّل "السيستم 0 · عدّيت 2". دي من أهم نتائج الجرد. */
  codes.forEach(function (k) {
    var it = m[k];
    if (!/^\d{6,14}$/.test(k)) bad++;
    if (it.stock <= 0) return;
    inStock++;
    if (it.multi) { multi++; batches += it.batches.length; }
    if (!it.batches[0].expire) noExp++;
  });
  var pct = inStock ? Math.round(multi / inStock * 100) : 0;
  Logger.log('════ جاهزية الجرد ════');
  Logger.log('إجمالي الأصناف       : ' + codes.length);
  Logger.log('فيها رصيد            : ' + inStock + '  ← الأساس اللي بنحسب عليه');
  Logger.log('أكواد شكلها غلط      : ' + bad);
  Logger.log('بأكتر من صلاحية      : ' + multi + ' (' + pct + '% من اللي فيها رصيد · ' + batches + ' دفعة)');
  Logger.log('من غير صلاحية مسجلة  : ' + noExp);
  Logger.log('');
  Logger.log('👉 "بأكتر من صلاحية" = الأصناف اللي الشاشة هتوقف عندها.');
  var ex = codes.filter(function (k) { return m[k].multi && m[k].stock > 0; }).slice(0, 5);
  ex.forEach(function (k) {
    Logger.log('  ' + k + ' ' + m[k].name + ' → ' +
      m[k].batches.map(function (b) { return b.expire + '×' + b.stock; }).join('  '));
  });
  return { ok: true, total: codes.length, inStock: inStock,
           multi: multi, multiPct: pct, batches: batches, noExp: noExp, bad: bad };
}

/* 🩺 قياس زمن بناء اللقطة — بيقيس كل جزء لوحده.
   سبب وجودها: buildSnapshot بتحسب التلاتة في نداء واحد، وسقف
   Apps Script 6 دقايق. لو المجموع قرب من السقف، اللقطة بتتقطع
   وتفضل "لسه متبنيتش" من غير أي رسالة خطأ. */
function timeSnapshot() {
  var out = { ok: true, parts: [], total: 0, limit: 360 };
  function step(name, fn) {
    var t0 = Date.now(), r = null, err = '';
    try { r = fn(); } catch (e) { err = e.message; }
    var secs = Math.round((Date.now() - t0) / 1000);
    out.total += secs;
    out.parts.push({
      name: name, secs: secs,
      ok: !err && r && r.ok !== false,
      detail: err ? err : (r && r.ok !== false ? 'تمام' : 'رجع فاضي')
    });
    return r;
  }

  var d = step('الديون',    function () { return getDebtsData(); });
  if (d && d.ok) out.parts[0].detail = d.count + ' مدين';

  var i = step('المخزون',   function () { return getInventoryAging_uncached(); });
  if (i && i.ok) out.parts[1].detail = i.sku_in_stock + ' صنف فيه رصيد';

  var a = step('المندوبين', function () { return getAgentsData(); });
  if (a && a.ok) out.parts[2].detail = a.agents.length + ' مندوب';

  out.tooSlow = out.total > 300;
  out.willFail = out.total > 360;
  return out;
}

/* 🧪 اختبار سريع للتخزين الجديد — بيكتب ويقرا حاجة صغيرة.
   لو نجحت، يبقى اللقطة الحقيقية هتنجح أكيد. شغّلها قبل buildSnapshot
   عشان توفّر دقيقتين انتظار لو فيه مشكلة. */
function testSnapStorage() {
  try {
    var probe = { ok: true, hello: 'اختبار', when: new Date().toISOString(), pad: '' };
    for (var i = 0; i < 60; i++) probe.pad += 'ابجدهوز';   // نجرب التقسيم كمان
    var kb = snapSave_('__test__', probe);
    var back = snapLoad_('__test__');
    fxClearCache_('snap___test__');
    if (back && back.hello === 'اختبار') {
      Logger.log('✅ التخزين شغال — كتبنا وقرينا ' + kb + ' ك.ب بنجاح');
      Logger.log('   دلوقتي شغّل buildSnapshot عادي.');
      return { ok: true, kb: kb };
    }
    Logger.log('❌ اتكتب بس القراءة رجعت غلط');
    return { ok: false };
  } catch (e) {
    Logger.log('❌ فشل: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📋 الجرود الشغالة — محفوظة على السيرفر مش على موبايل الموظف
//
// المشكلة اللي بتحلها: النسخة الأولى كانت بتحفظ الجرد في
// localStorage. يعني الجرد حبيس الموبايل اللي بدأه — مفيش زميل
// يكمّله، ولو الموبايل ضاع الشغل يضيع، وإنت من بعيد مش شايف
// إن فيه جرد شغال أصلاً.
//
// دلوقتي بيتحفظ كل 10 مسحات في شيت، وأي موبايل يفتح scan.html
// يلاقي الجرود الشغالة كلها ويكمّل في أي واحد.
// ═══════════════════════════════════════════════════════════════════

var COUNT_OPEN_SHEET = 'جرود شغالة';

function openCountSheet_() {
  var sh = getOrCreateSheet_(COUNT_OPEN_SHEET,
    ['رقم الجلسة', 'العنوان', 'الموظف', 'بدأ', 'آخر تحديث', 'عدد السطور', 'البيانات', 'ms']);
  if (sh.getRange(1, 8).getValue() !== 'ms') sh.getRange(1, 8).setValue('ms');
  return sh;
}

/* حفظ تلقائي أثناء الجرد. بيستبدل صف الجلسة أو يضيفه. */
/* ═══════════════════════════════════════════════════════════════
   حفظ تلقائي أثناء الجرد — بالدمج مش بالاستبدال.

   ⚠️ العطل اللي بيحله: كل موبايل كان بيرفع نسخته كاملة، فلو
   موظفين شغالين على نفس الجرد كان الأخير بيمسح شغل الأول:
       9:10 ولاء رفعت 45 سطر
       9:12 حمادة رفع 35 (نسخته القديمة) ← الـ10 بتوع ولاء ضاعوا

   دلوقتي الموبايل بيبعت اللي عنده، والسيرفر بيدمجه في الموجود.
   آخر تعديل بالوقت هو اللي يكسب لنفس المفتاح.
   القفل ضروري: موظفين ممكن يرفعوا في نفس اللحظة.
   ═══════════════════════════════════════════════════════════════ */
function saveOpenCount(data) {
  var lock = LockService.getScriptLock();
  try { if (!lock.tryLock(20000)) return { ok: false, error: 'مشغول — جرب تاني' }; }
  catch (e) { return { ok: false, error: 'مشغول' }; }

  try {
    var d = (typeof data === 'string') ? JSON.parse(data) : data;
    if (!d.sessionId) return { ok: false, error: 'رقم الجلسة ناقص' };

    var sh = openCountSheet_();
    var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    var last = sh.getLastRow(), row = -1, started = now, existing = [];

    if (last > 1) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(d.sessionId)) { row = i + 2; break; }
      }
    }
    if (row !== -1) {
      started = sh.getRange(row, 4).getValue() || now;
      try { existing = JSON.parse(sh.getRange(row, 7).getValue() || '[]'); } catch (e2) {}
    }

    /* الدمج: مفتاح = كود|صلاحية. الأحدث بالوقت يكسب. */
    var map = {};
    existing.forEach(function (L) {
      if (L && L.code) map[L.code + '|' + (L.expire || '')] = L;
    });
    (d.lines || []).forEach(function (L) {
      if (!L || !L.code) return;
      var k = L.code + '|' + (L.expire || '');
      var prev = map[k];
      /* السطر عندنا أحدث؟ يبقى موظف تاني عدّله بعد ما الموبايل ده
         نزّل نسخته — نسيبه */
      if (prev && (+prev.at || 0) > (+L.at || 0)) return;
      if ((+L.qty || 0) <= 0) delete map[k];
      else map[k] = L;
    });

    var merged = Object.keys(map).map(function (k) { return map[k]; });
    merged.sort(function (a, b) { return (+a.at || 0) - (+b.at || 0); });

    var json = JSON.stringify(merged);
    if (json.length > 45000) {
      merged = merged.slice(-320);          /* سقف الخلية ~50 ألف حرف */
      json = JSON.stringify(merged);
    }

    var out = [d.sessionId, d.title || 'جرد', d.by || '', started, now,
               merged.length, json, Date.now()];
    if (row === -1) sh.appendRow(out);
    else sh.getRange(row, 1, 1, 8).setValues([out]);

    /* بنرجّع المدموج عشان الموبايل يشوف شغل زمايله */
    return { ok: true, at: now, lines: merged, count: merged.length };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
}

/* قايمة الجرود الشغالة + آخر 5 أصناف لكل موظف.
   الـ5 دول هما اللي بيقولوا للموظف "كنت واقف فين" لما يرجع تاني يوم —
   الأرقام المجمّعة لوحدها مبتفكّرش بمكان على الرف. */
function listOpenCounts(params) {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_OPEN_SHEET);
    if (!sh || sh.getLastRow() <= 1) return { ok: true, open: [], total: scanTotalItems_() };

    var who = (params && params.by) ? String(params.by).trim() : '';
    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();

    var out = d.filter(function (r) { return r[0]; }).map(function (r) {
      var lines = [];
      try { lines = JSON.parse(r[6] || '[]'); } catch (e) {}

      /* آخر 5 — بترتيب الإضافة، الأحدث الأول */
      var recent = lines.slice(-5).reverse().map(function (L) {
        return { name: L.name || '', qty: L.qty, expire: L.expire || '', at: L.at || '' };
      });

      /* عدد الأصناف الفريدة — مش عدد السطور.
         الصنف بصلاحيتين بياخد سطرين بس هو صنف واحد. */
      var uniq = {};
      lines.forEach(function (L) { if (L.code) uniq[L.code] = 1; });

      /* لو الموظف معروف، نطلّع آخر 5 بتاعته هو تحديدًا */
      var mine = null;
      if (who) {
        var his = lines.filter(function (L) { return String(L.who || '') === who; });
        if (his.length) mine = his.slice(-5).reverse().map(function (L) {
          return { name: L.name || '', qty: L.qty, expire: L.expire || '', at: L.at || '' };
        });
      }

      return { id: String(r[0]), title: r[1], by: r[2],
               started: String(r[3]), updated: String(r[4]),
               updatedMs: (parseFloat(r[7]) || 0),
               lines: Object.keys(uniq).length,   /* أصناف مش سطور */
               rows: r[5],
               recent: recent, mine: mine };
    });

    out.sort(function (a, b) { return String(b.updated).localeCompare(String(a.updated)); });
    return { ok: true, open: out, total: scanTotalItems_() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* عدد الأصناف اللي فيها رصيد — المقام بتاع نسبة التقدّم.
   من غيره "47 صنف" رقم ملوش معنى. */
function scanTotalItems_() {
  try {
    var hit = fxCacheGet_('fx_scan_total');
    if (hit) return hit.n;
    var m = scanIndex_(), c = 0;
    Object.keys(m).forEach(function (k) { if (m[k].stock > 0) c++; });
    fxCachePut_('fx_scan_total', { n: c }, 1800);
    return c;
  } catch (e) { return 0; }
}

/* فتح جرد شغال للتكملة */
function loadOpenCount(sessionId) {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_OPEN_SHEET);
    if (!sh || sh.getLastRow() <= 1) return { ok: false, error: 'مش موجود' };
    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    for (var i = 0; i < d.length; i++) {
      if (String(d[i][0]) !== String(sessionId)) continue;
      var lines = [];
      try { lines = JSON.parse(d[i][6] || '[]'); } catch (e) {}
      return { ok: true, sessionId: String(d[i][0]), title: d[i][1],
               by: d[i][2], lines: lines };
    }
    return { ok: false, error: 'مش موجود' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function removeOpenCount_(sessionId) {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_OPEN_SHEET);
    if (!sh || sh.getLastRow() <= 1) return;
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === String(sessionId)) { sh.deleteRow(i + 2); return; }
    }
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════
// 🔁 الفحص الدوري — إيه اللي بقاله كتير من غير جرد
//
// الفكرة: الجرد الجزئي المتكرر أنفع من الشامل النادر. الموظف يجرد
// 50 صنف في اليوم من القايمة دي، فالمشكلة تتكشف وهي صغيرة.
//
// الترتيب بالخطورة = القيمة × مدة الإهمال، مش بالمدة لوحدها —
// صنف بـ2400 جنيه معدّاش عليه 6 شهور أخطر بكتير من صنف بـ20 جنيه.
// ═══════════════════════════════════════════════════════════════════

function getCountDue(params) {
  try {
    var limit = parseInt((params && params.limit) || '60', 10);
    if (isNaN(limit) || limit < 1) limit = 60;

    /* آخر جرد لكل صنف — من سجل سطور الجرد */
    var lastSeen = {};
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_LINES_SHEET);
    if (sh && sh.getLastRow() > 1) {
      var d = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
      d.forEach(function (r) {
        var code = String(r[4] || '').replace(/[^\d]/g, '');
        if (!code) return;
        var when = (r[0] instanceof Date)
          ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd')
          : String(r[0]).substring(0, 10);
        if (!lastSeen[code] || when > lastSeen[code]) lastSeen[code] = when;
      });
    }

    var idx = scanIndex_();
    var today = new Date();
    var todayStr = Utilities.formatDate(today, 'Africa/Cairo', 'yyyy-MM-dd');
    var out = [], neverCount = 0, totalValue = 0;

    Object.keys(idx).forEach(function (code) {
      var it = idx[code];
      if (it.stock <= 0) return;                 // الصفر ملوش لازمة نجرده

      var value = it.stock * it.price;
      var seen = lastSeen[code] || '';
      var days;
      if (seen) {
        days = Math.floor((new Date(todayStr) - new Date(seen)) / 86400000);
      } else {
        days = 999;                              // عمره ما اتجرد
        neverCount++;
      }

      /* الخطورة = القيمة × الأيام. بنقسّم على 365 عشان الرقم يفضل
         في حجم معقول ويبقى معناه "قيمة معرّضة لسنة". */
      var risk = value * (days / 365);
      totalValue += value;

      out.push({
        code: code, name: it.name, cat: it.cat,
        stock: Math.round(it.stock * 100) / 100,
        value: Math.round(value),
        lastCount: seen, days: days === 999 ? null : days,
        risk: Math.round(risk)
      });
    });

    out.sort(function (a, b) { return b.risk - a.risk; });

    return {
      ok: true,
      total: out.length,
      never_counted: neverCount,
      total_value: Math.round(totalValue),
      items: out.slice(0, limit)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* أسماء الموظفين لشاشة الجرد — الموظف بيختار من قايمة بدل ما يكتب.
   الكتابة اليدوية كانت بتنتج "أحمد" و"احمد" و"احمد " كأنهم تلاتة. */
function getScanStaff() {
  try {
    var out = [];
    Object.keys(EMPLOYEES).forEach(function (k) {
      out.push({ id: k, name: EMPLOYEES[k] });
    });
    return { ok: true, staff: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🔧 أمر تصحيح الأرصدة — ناتج الجرد بيتحوّل لليستة تنفيذية للمدير
//
// المدير مش محتاج تحليل، محتاج يعرف بالظبط إيه اللي يكتبه في نظام
// البيع. عشان كده الكود بييجي الأول (بيدوّر بيه مباشرة مش بالاسم)،
// والصلاحيات الجديدة في قسم منفصل لأنها إدخال دفعة مش تصحيح رصيد.
// ═══════════════════════════════════════════════════════════════════

function getFixOrder(sessionId) {
  try {
    var rep = getCountReport(sessionId);
    if (!rep || !rep.ok) return { ok: false, error: (rep && rep.error) || 'مفيش بيانات' };

    var idx = scanIndex_();
    var fixes = [], newBatches = [], netValue = 0;

    (rep.lines || []).forEach(function (L) {
      if (Math.abs(L.diff) <= 0.001) return;      // مطابق، مش محتاج حاجة
      var it = idx[L.code] || null;
      var row = {
        code: L.code, name: L.name,
        expire: (L.expire && L.expire !== '—') ? L.expire : '',
        sys: L.sys, counted: L.counted, diff: L.diff,
        value: L.diffValue,
        units: it ? (it.units || 1) : 1
      };
      netValue += (L.diffValue || 0);

      /* الصلاحية اللي الموظف لقاها ومش في السيستم = إدخال دفعة جديدة،
         مش تعديل رصيد. المدير بيعملها بخطوة مختلفة تمامًا. */
      if (String(L.note || '').indexOf('صلاحية زيادة') !== -1) newBatches.push(row);
      else fixes.push(row);
    });

    fixes.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
    newBatches.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });

    var head = getCountSessions();
    var meta = { title: '', by: '', at: '' };
    if (head && head.ok) {
      var m = (head.sessions || []).filter(function (x) { return String(x.id) === String(sessionId); })[0];
      if (m) meta = { title: m.title, by: m.by, at: String(m.at) };
    }

    return {
      ok: true, sessionId: sessionId, meta: meta,
      fixes: fixes, newBatches: newBatches,
      count: fixes.length + newBatches.length,
      netValue: Math.round(netValue),
      text: buildFixText_(meta, fixes, newBatches, netValue)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* نص جاهز للنسخ — مصمّم يتقرا على الموبايل من غير جدول */
function buildFixText_(meta, fixes, newB, netValue) {
  var L = [];
  L.push('🔧 تصحيح أرصدة');
  L.push(meta.title || 'جرد');
  if (meta.by) L.push('جرد بواسطة: ' + meta.by);
  L.push(SEP);

  if (fixes.length) {
    L.push('');
    L.push('📝 تعديل رصيد (' + fixes.length + ')');
    fixes.forEach(function (r) {
      L.push('');
      L.push('• ' + r.name);
      L.push('  كود: ' + r.code);
      if (r.expire) L.push('  صلاحية: ' + r.expire);
      L.push('  السيستم ' + r.sys + ' ← الصح ' + r.counted +
             '  (' + (r.diff > 0 ? '+' : '') + r.diff + ')');
    });
  }

  if (newB.length) {
    L.push('');
    L.push(SEP);
    L.push('🆕 صلاحيات مش مسجلة (' + newB.length + ')');
    L.push('دي دفعات موجودة على الرف ومش في السيستم — تتدخل كدفعة جديدة');
    newB.forEach(function (r) {
      L.push('');
      L.push('• ' + r.name);
      L.push('  كود: ' + r.code);
      L.push('  صلاحية: ' + (r.expire || '؟'));
      L.push('  الكمية: ' + r.counted);
    });
  }

  L.push('');
  L.push(SEP);
  L.push('صافي فرق القيمة: ' + Math.round(netValue) + ' جنيه');
  return L.join('\n');
}

/* بعت الأمر على جروب الموظفين. الرسايل الطويلة بتتقسّم —
   تليجرام سقفه 4096 حرف وبيرفض اللي أطول من غير رسالة واضحة. */
function sendFixOrder(sessionId) {
  try {
    var f = getFixOrder(sessionId);
    if (!f.ok) return f;
    if (!f.count) return { ok: false, error: 'مفيش فروقات — الجرد كله مطابق' };

    var t = f.text, max = 3800;
    if (t.length <= max) {
      sendTelegramStaff(t, STAFF_GROUP);
    } else {
      var parts = [], cur = '';
      t.split('\n').forEach(function (line) {
        if ((cur + line).length > max) { parts.push(cur); cur = ''; }
        cur += line + '\n';
      });
      if (cur) parts.push(cur);
      parts.forEach(function (p, i) {
        sendTelegramStaff(p + (parts.length > 1 ? ('\n(' + (i+1) + '/' + parts.length + ')') : ''),
                          STAFF_GROUP);
        Utilities.sleep(400);
      });
    }
    return { ok: true, sent: f.count, parts: Math.ceil(t.length / max) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* 🗑️ مسح جرد — الجلسة وكل سطورها.
   ⚠️ مالوش رجعة، عشان كده بينادى من doPost بس (مش من رابط)
   ولازم يتبعت معاه confirm:'DELETE' — عشان نقرة غلط متمسحش شغل يوم. */
function deleteCountSession(data) {
  try {
    var id = String((data && data.sessionId) || '').trim();
    if (!id) return { ok: false, error: 'رقم الجلسة ناقص' };
    if (String(data.confirm || '') !== 'DELETE') {
      return { ok: false, error: 'التأكيد ناقص' };
    }

    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var removed = 0, title = '';

    /* السطور — بنمشي من تحت لفوق عشان حذف صف ميزحلقش اللي بعده */
    var ls = ss.getSheetByName(COUNT_LINES_SHEET);
    if (ls && ls.getLastRow() > 1) {
      var lr = ls.getRange(2, 2, ls.getLastRow() - 1, 1).getValues();
      for (var i = lr.length - 1; i >= 0; i--) {
        if (String(lr[i][0]) === id) { ls.deleteRow(i + 2); removed++; }
      }
    }

    /* رأس الجلسة */
    var hs = ss.getSheetByName(COUNT_SESSIONS_SHEET);
    if (hs && hs.getLastRow() > 1) {
      var hr = hs.getRange(2, 1, hs.getLastRow() - 1, 3).getValues();
      for (var j = hr.length - 1; j >= 0; j--) {
        if (String(hr[j][1]) === id) { title = hr[j][2]; hs.deleteRow(j + 2); }
      }
    }

    /* الجرد الشغال — ده اللي كان بيفضل موجود لأن المسح كان
       بيشوف المقفولة بس */
    var wasOpen = false;
    var os = ss.getSheetByName(COUNT_OPEN_SHEET);
    if (os && os.getLastRow() > 1) {
      var or_ = os.getRange(2, 1, os.getLastRow() - 1, 2).getValues();
      for (var z = or_.length - 1; z >= 0; z--) {
        if (String(or_[z][0]) === id) {
          if (!title) title = or_[z][1];
          os.deleteRow(z + 2); wasOpen = true;
        }
      }
    }

    if (!removed && !title && !wasOpen) return { ok: false, error: 'الجرد ده مش موجود' };

    sendTelegramStaff('🗑️ اتمسح جرد: ' + (title || id) +
      ' (' + removed + ' سطر)', PERSONAL_CHAT);
    return { ok: true, removed: removed, title: title };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// ⚡ فهرس المسح — ينزل على الموبايل مرة واحدة في أول الجرد
//
// المشكلة: كنا بنعمل نداء شبكة لكل مسحة. على النت المصري ده
// 0.5–2 ثانية × 2,309 صنف = ~40 دقيقة انتظار صافي.
//
// الحل: الفهرس كله (~400 ك.ب) ينزل مرة واحدة، وبعدها كل مسحة
// بتلاقي الصنف فورًا من غير نت.
//
// التنازل: الأرصدة ممكن تبقى قديمة بساعة. بس ده مش عيب —
// وقت اللقطة بيتسجل مع كل سطر، فالتقرير بيقول "السيستم كان 2
// الساعة 9:15" وإنت تقدر تراجع الحركة بينها وبين وقت العدّ.
// ═══════════════════════════════════════════════════════════════════

function getScanBundle() {
  try {
    var m = scanIndex_();
    var at = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    var ms = Date.now();

    /* مصفوفات مش كائنات — بتوفّر ~40% من الحجم على النت */
    var items = [];
    Object.keys(m).forEach(function (code) {
      var it = m[code];
      items.push([
        code,
        it.name,
        it.units || 1,
        it.multi ? 1 : 0,
        (it.batches || []).map(function (b) { return [b.expire || '', b.stock || 0]; })
      ]);
    });

    return { ok: true, at: at, ms: ms, count: items.length, items: items };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 👥 اللي شغال دلوقتي + جرد كل موظف خلال فترة
//
// ⚠️ المقياس هنا "صنف" مش "علبة" عن قصد.
// لو قسنا بالعلبة، الموظف هيدوّر على الرفوف اللي فيها كميات كبيرة
// (علبة فيها 20 = 20 دوسة) ويسيب الرفوف الصعبة اللي فيها أصناف
// متفرقة وصلاحيات متعددة — وهي بالظبط اللي بتخبّي المشاكل.
// "الأصناف اللي فيها فرق" أهم رقم: اللي بيلاقي فروقات بيبص فعلاً.
// ═══════════════════════════════════════════════════════════════════

function getCountActivity(params) {
  try {
    var R = resolveRange_(params);
    var byWho = {}, live = [];

    function touch(who) {
      if (!byWho[who]) byWho[who] = { who: who, items: {}, units: 0, gaps: 0, days: {}, last: 0 };
      return byWho[who];
    }

    /* (١) الجرود المقفولة — من سطور الجرد */
    var ls = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_LINES_SHEET);
    if (ls && ls.getLastRow() > 1) {
      var d = ls.getRange(2, 1, ls.getLastRow() - 1, 10).getValues();
      d.forEach(function (r) {
        var day = (r[0] instanceof Date)
          ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd')
          : String(r[0]).substring(0, 10);
        if (day < R.from || day > R.to) return;
        var who = String(r[3] || '').trim() || 'مش معروف';
        var a = touch(who);
        a.items[String(r[4])] = 1;
        a.units += (parseFloat(r[8]) || 0);
        if (Math.abs(parseFloat(r[9]) || 0) > 0.001) a.gaps++;
        a.days[day] = 1;
      });
    }

    /* (٢) الجرود الشغالة — لسه متسجلتش في السطور */
    var os = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_OPEN_SHEET);
    if (os && os.getLastRow() > 1) {
      var o = os.getRange(2, 1, os.getLastRow() - 1, 8).getValues();
      o.forEach(function (r) {
        var lines = [];
        try { lines = JSON.parse(r[6] || '[]'); } catch (e) {}
        var perWho = {};

        lines.forEach(function (L) {
          if (!L || !L.code) return;
          var when = +L.at || 0;
          var day = when ? Utilities.formatDate(new Date(when), 'Africa/Cairo', 'yyyy-MM-dd')
                         : String(r[4]).substring(0, 10);
          if (day < R.from || day > R.to) return;

          var who = String(L.who || r[2] || '').trim() || 'مش معروف';
          var a = touch(who);
          a.items[L.code] = 1;
          a.units += (+L.qty || 0);
          if (Math.abs((+L.qty || 0) - (+L.sys || 0)) > 0.001) a.gaps++;
          a.days[day] = 1;
          if (when > a.last) a.last = when;

          if (!perWho[who]) perWho[who] = { items: {}, units: 0, last: 0 };
          perWho[who].items[L.code] = 1;
          perWho[who].units += (+L.qty || 0);
          if (when > perWho[who].last) perWho[who].last = when;
        });

        /* مين شغال دلوقتي — آخر مسحة خلال ساعتين */
        var cutoff = Date.now() - 2 * 3600 * 1000;
        Object.keys(perWho).forEach(function (w) {
          if (perWho[w].last < cutoff) return;
          live.push({
            who: w, session: String(r[0]), title: r[1],
            items: Object.keys(perWho[w].items).length,
            units: Math.round(perWho[w].units * 100) / 100,
            lastMs: perWho[w].last
          });
        });
      });
    }

    var total = scanTotalItems_();
    var staff = Object.keys(byWho).map(function (w) {
      var a = byWho[w];
      var items = Object.keys(a.items).length;
      return {
        who: w, items: items,
        units: Math.round(a.units * 100) / 100,
        gaps: a.gaps,
        days: Object.keys(a.days).length,
        coverage: total ? Math.round(items / total * 1000) / 10 : 0,
        lastMs: a.last
      };
    });
    /* الترتيب بالتغطية مش بالكمية — عشان مفيش مكسب من مطاردة العلب */
    staff.sort(function (a, b) { return b.items - a.items; });

    live.sort(function (a, b) { return b.lastMs - a.lastMs; });

    return { ok: true, label: R.label, from: R.from, to: R.to,
             total: total, staff: staff, live: live };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 دقة المخزون — من نتايج الجرد
//
// الفكرة: الجرد بيقارن اللي على الرف بالسيستم. كل سطر إما مطابق أو
// فيه فرق. الدقة = المطابق ÷ المتجرّد.
//
// ⚠️ حدود الرقم ده لازم تتعرف:
//   • هو دقة "اللي اتجرد" بس مش المخزون كله — لو اتجرد 10% من الأصناف
//     فالرقم عينة منهم، ولازم يتقري مع نسبة التغطية.
//   • الرصيد المقارَن بيه هو رصيد لقطة وقت العدّ (لو الموبايل بعته)،
//     وإلا رصيد وقت الحفظ — وده ممكن يتأثر بحركة بيع/استلام بينهم.
//     snapShare بيقولك كام % من السطور مقارنة بلقطة حقيقية.
//   • "صلاحية زيادة" (دفعة على الرف مش في السيستم) محسوبة غلط مش مطابقة.
// ═══════════════════════════════════════════════════════════════════
function getCountAccuracy(params) {
  try {
    var P = params || {};
    var R = resolveRange_({ range: P.range || 'all', from: P.from, to: P.to });
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_LINES_SHEET);
    var totalItems = scanTotalItems_();
    if (!sh || sh.getLastRow() <= 1) {
      return { ok: true, label: R.label, sessions: [], last: null, overall: null,
               byCategory: [], coverage: { counted: 0, total: totalItems, pct: 0 }, snapShare: 0 };
    }

    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 14).getValues();
    var idx = scanIndex_();
    var tz = 'Africa/Cairo';
    var S = {}, order = [], cat = {}, uniq = {};
    var all = { lines: 0, matched: 0, newBatch: 0, absVal: 0, baseVal: 0, withSnap: 0 };

    function bump(o, matched, isNew, absVal, baseVal) {
      o.lines++; if (matched) o.matched++; if (isNew) o.newBatch++;
      o.absVal += absVal; o.baseVal += baseVal;
    }
    function acc(o) {
      return {
        lines: o.lines, matched: o.matched, newBatch: o.newBatch,
        accuracy: o.lines ? Math.round(o.matched / o.lines * 1000) / 10 : null,
        valueAccuracy: o.baseVal > 0 ? Math.round((1 - o.absVal / o.baseVal) * 1000) / 10 : null,
        gapValue: Math.round(o.absVal)
      };
    }

    d.forEach(function (r) {
      var sid = String(r[1] || ''); if (!sid) return;
      var day = (r[0] instanceof Date) ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd')
                                        : String(r[0] || '').substring(0, 10);
      if (day < R.from || day > R.to) return;

      var code = String(r[4] || '').replace(/[^\d]/g, '');
      var sys = parseFloat(r[7]) || 0, cnt = parseFloat(r[8]) || 0, diff = parseFloat(r[9]) || 0;
      var price = idx[code] ? idx[code].price : 0;
      var absVal = Math.abs(diff) * price, baseVal = Math.max(sys, cnt) * price;
      var isNew = String(r[12] || '').indexOf('صلاحية زيادة') !== -1;
      var matched = !isNew && Math.abs(diff) <= 0.001;
      var cname = String(r[11] || '').trim() || 'غير مصنّف';

      if (!S[sid]) {
        S[sid] = { id: sid, title: r[2], at: String(r[0] instanceof Date
                    ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm:ss') : r[0]),
                   lines: 0, matched: 0, newBatch: 0, absVal: 0, baseVal: 0 };
        order.push(sid);
      }
      bump(S[sid], matched, isNew, absVal, baseVal);
      bump(all, matched, isNew, absVal, baseVal);
      if (String(r[13] || '') !== '') all.withSnap++;

      if (!cat[cname]) cat[cname] = { lines: 0, matched: 0, newBatch: 0, absVal: 0, baseVal: 0 };
      bump(cat[cname], matched, isNew, absVal, baseVal);

      if (code && idx[code] && idx[code].stock > 0) uniq[code] = 1;
    });

    var sessions = order.map(function (id) {
      var o = acc(S[id]); o.id = id; o.title = S[id].title; o.at = S[id].at; return o;
    }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

    var byCategory = Object.keys(cat).map(function (k) {
      var o = acc(cat[k]); o.category = k; return o;
    }).sort(function (a, b) { return b.gapValue - a.gapValue; });   /* الأكبر خطأ بالفلوس فوق */

    var counted = Object.keys(uniq).length;
    return {
      ok: true, label: R.label,
      sessions: sessions,
      last: sessions.length ? sessions[0] : null,
      overall: acc(all),
      byCategory: byCategory,
      coverage: { counted: counted, total: totalItems,
                  pct: totalItems ? Math.round(counted / totalItems * 1000) / 10 : 0 },
      snapShare: all.lines ? Math.round(all.withSnap / all.lines * 100) : 0
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}