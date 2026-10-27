// ==== MODULE 74_orders (split from server/Code.js; load order = file name order) ====


// ═══════════════════════════════════════════════════════════════════
// 🛒 صفحة طلب النواقص — orders.html
// لما قفل اللوحة شغّال، أوامر الصفحة محتاجة الرقم السري زي باقي اللوحة.
// علامة "اتطلب" في Script Properties وبتتمسح لوحدها آخر اليوم (القاهرة).
// البوت بيعلّم بمفتاح الخاصية ORDERS_BOT_KEY — القيمة مش متكتوبة هنا.
// ═══════════════════════════════════════════════════════════════════

/* مفتاح البوت. الاتنشاء من الإعدادات > الصيانة عشان محدش يفتح محرر السكربت. */
function ordersBotOk_(k) {
  if (!k) return false;
  var saved = '';
  try { saved = PropertiesService.getScriptProperties().getProperty('ORDERS_BOT_KEY') || ''; } catch (e) { return false; }
  return !!saved && String(k) === saved;
}
function ensureOrdersBotKey_(regen) {
  var P = PropertiesService.getScriptProperties();
  var cur = P.getProperty('ORDERS_BOT_KEY') || '';
  if (regen || !cur) {
    cur = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
    P.setProperty('ORDERS_BOT_KEY', cur);
  }
  return { ok: true, key: cur, property: 'ORDERS_BOT_KEY' };
}

function ordMarkKey_(code, name) {
  var c = String(code || '').replace(/[^\d]/g, '');
  if (c) return 'c:' + c;
  var n = doctorNorm_(name);
  return n ? ('n:' + n) : '';
}
function ordMarksRaw_(P) {
  var n = parseInt(P.getProperty('ORD_MARKS_N') || '0', 10);
  if (n > 0) {
    var s = '';
    for (var i = 0; i < n && i < 12; i++) s += P.getProperty('ORD_MARKS_' + i) || '';
    return s;
  }
  return P.getProperty('ORD_MARKS') || '';
}
function ordMarksClear_(P) {
  var n = parseInt(P.getProperty('ORD_MARKS_N') || '0', 10);
  for (var i = 0; i < n && i < 12; i++) { try { P.deleteProperty('ORD_MARKS_' + i); } catch (e) {} }
  try { P.deleteProperty('ORD_MARKS_N'); } catch (e2) {}
  try { P.deleteProperty('ORD_MARKS'); } catch (e3) {}
}
/* يوم القاهرة. لو التاريخ اتغيّر العلامات القديمة بتتمسح ومش بتترجع. */
function ordMarksLoad_() {
  var P = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var raw = ordMarksRaw_(P);
  var o = null;
  try { o = raw ? JSON.parse(raw) : null; } catch (e) { o = null; }
  if (o && o.d === today) return { day: today, map: o.m || {}, stale: false };
  return { day: today, map: {}, stale: !!raw };
}
function ordMarksRead_() {
  var r = ordMarksLoad_();
  if (!r.stale) return r;
  var lock = LockService.getUserLock();
  try {
    if (lock.tryLock(4000)) {
      r = ordMarksLoad_();
      if (r.stale) ordMarksClear_(PropertiesService.getScriptProperties());
      try { lock.releaseLock(); } catch (eR) {}
      r.stale = false;
    }
  } catch (e) {}
  return r;
}
function ordMarksWrite_(map) {
  var P = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var json = JSON.stringify({ d: today, m: map || {} });
  var CHUNK = 7000, n = Math.max(1, Math.ceil(json.length / CHUNK));
  if (n > 8) return { ok: false, msg: 'علامات كتير أوي النهاردة' };
  var prev = parseInt(P.getProperty('ORD_MARKS_N') || '0', 10);
  for (var i = 0; i < n; i++) P.setProperty('ORD_MARKS_' + i, json.substring(i * CHUNK, (i + 1) * CHUNK));
  for (var j = n; j < prev; j++) { try { P.deleteProperty('ORD_MARKS_' + j); } catch (e) {} }
  P.setProperty('ORD_MARKS_N', String(n));
  try { P.deleteProperty('ORD_MARKS'); } catch (e2) {}
  return { ok: true, day: today };
}
function ordMarksPublic_(map) {
  var out = [];
  Object.keys(map || {}).forEach(function (k) {
    var m = map[k] || {};
    out.push({ key: k, code: m.code || '', name: m.name || '', wh: m.wh || '', qty: m.qty || 0, by: m.by || '', at: m.at || '' });
  });
  return out;
}
function ordersWithMarks_(out) {
  if (!out || out.ok === false) return out;
  try {
    var r = ordMarksRead_();
    out.day = r.day;
    out.marks = ordMarksPublic_(r.map);
  } catch (e) { out.marks = []; }
  return out;
}

/* تعليم "اتطلب" أو شيله. viaBot = النداء جاي بمفتاح البوت مش من الصفحة. */
function markOrdered_(p, viaBot) {
  p = p || {};
  var list = [];
  if (p.items) {
    var raw = p.items;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (eJ) { return { ok: false, msg: 'القائمة مش مظبوطة' }; } }
    if (!Array.isArray(raw)) return { ok: false, msg: 'القائمة مش مظبوطة' };
    list = raw.slice(0, 80);
  } else list = [p];
  if (!list.length) return { ok: false, msg: 'ابعت كود الصنف أو اسمه' };

  /* قفل المستخدم، مش قفل السكربت. قفل السكربت واحد وبيتمسك دقايق في التريجر الحي
     (checkStaffOrders) ولقطة الساعة وقراية ملفات الدرايف، فـ tryLock(15000) كان بيرجع
     "مشغول — جرب تاني" حتى والمفتاح صح. علامات الطلب كتابة قصيرة، والقفل هنا يمنع كتابتين مع بعض. */
  var lock = LockService.getUserLock();
  try { if (!lock.tryLock(15000)) return { ok: false, msg: 'مشغول — جرب تاني' }; }
  catch (eL) { return { ok: false, msg: 'مشغول' }; }
  try {
    var loaded = ordMarksLoad_();
    if (loaded.stale) ordMarksClear_(PropertiesService.getScriptProperties());
    var map = loaded.stale ? {} : (loaded.map || {});
    var whoDefault = viaBot ? 'البوت' : 'اللوحة';
    var at = Utilities.formatDate(new Date(), 'Africa/Cairo', 'HH:mm');
    var any = false;
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var key = ordMarkKey_(it.code, it.name);
      if (!key) continue;
      any = true;
      var on = !(it.on === 0 || it.on === '0' || it.on === false || it.on === 'false');
      if (!on) { delete map[key]; continue; }
      /* الصفحة بتعلّم من غير مخزن/كمية — متمسحش اللي البوت كتبه لو الحقل مش مبعوت */
      var prev = map[key] || {};
      var whIn = (it.wh != null) ? it.wh : ((it.store != null) ? it.store : ((it.warehouse != null) ? it.warehouse : null));
      var wh = whIn === null ? (prev.wh || '') : String(whIn).trim().slice(0, 80);
      var qty;
      if (it.qty === undefined || it.qty === null || it.qty === '') qty = prev.qty || 0;
      else { qty = parseFloat(it.qty); if (!isFinite(qty) || qty < 0) qty = 0; qty = Math.round(qty * 100) / 100; }
      var by = String(it.by || '').trim().slice(0, 40) || prev.by || whoDefault;
      map[key] = {
        code: String(it.code || prev.code || '').replace(/[^\d]/g, ''),
        name: String(it.name || prev.name || '').trim().slice(0, 120),
        wh: wh, qty: qty, by: by, at: at
      };
    }
    if (!any) return { ok: false, msg: 'ابعت كود الصنف أو اسمه' };
    var saved = ordMarksWrite_(map);
    if (!saved.ok) return saved;
    return { ok: true, day: saved.day, marks: ordMarksPublic_(map) };
  } catch (e) {
    return { ok: false, msg: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* نسبة (سعر الصيدلي ÷ سعر الجمهور) لكل فئة من أصناف المخزون اللي فيها رصيد —
   بنستخدمها تقدير لو الصنف الناقص مفيهوش سعر صيدلي صريح. */
function ordersRatios_() {
  var hit = fxCacheGet_('fx_ord_ratios');
  if (hit) return hit;
  var out = { cat: {}, all: 0.8 };
  try {
    var sh = SpreadsheetApp.openById(STOCK_SHEET_ID).getSheets()[0];
    var lastCol = sh.getLastColumn(), n = sh.getLastRow() - 1;
    if (n < 1) return out;
    var hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0], ix = {};
    hdr.forEach(function (h, i) { ix[String(h || '').trim().toLowerCase()] = i; });
    if (ix['totnetcoast'] === undefined || ix['totprice'] === undefined) return out;
    var d = sh.getRange(2, 1, n, lastCol).getValues(), agg = {}, tc = 0, tp = 0;
    d.forEach(function (r) {
      var st = parseFloat(r[ix['stock']]) || 0, c = parseFloat(r[ix['totnetcoast']]) || 0, p = parseFloat(r[ix['totprice']]) || 0;
      if (st <= 0 || c <= 0 || p <= 0) return;
      var cat = String(r[ix['category']] || '').trim() || 'أخرى';
      var a = agg[cat] || (agg[cat] = { c: 0, p: 0 });
      a.c += c; a.p += p; tc += c; tp += p;
    });
    Object.keys(agg).forEach(function (k) { if (agg[k].p > 0) out.cat[k] = agg[k].c / agg[k].p; });
    if (tp > 0) out.all = tc / tp;
  } catch (e) {}
  fxCachePut_('fx_ord_ratios', out, 1800);
  return out;
}

function ordersPage(code, days) {
  try {
    var dd = [3, 7, 14, 30].indexOf(parseInt(days, 10)) !== -1 ? parseInt(days, 10) : 7;
    var key = 'fx_ord_page_v6_' + dd;
    var hit = fxCacheGet_(key);
    if (hit) return ordersWithMarks_(hit);

    var res = UrlFetchApp.fetch(SHORTAGE_SCRIPT_URL + '?action=getShortages&days=' + dd, { muteHttpExceptions: true });
    var d = JSON.parse(res.getContentText());
    if (!d || d.error) return { ok: false, msg: 'مقدرتش أجيب النواقص دلوقتي' };

    /* أسعار من المخزون كاحتياطي: بالكود الأول وبعدين بالاسم */
    var byCode = {}, byName = {};
    try { byCode = scanIndex_() || {}; } catch (e1) { byCode = {}; }
    var stByName = {};
    try { doctorIndex_().forEach(function (it) { if (!byName[it.h]) { byName[it.h] = it.p; stByName[it.h] = it.s; } }); } catch (e2) {}
    var ratios = ordersRatios_() || { cat: {}, all: 0.8 };
    if (!ratios.cat) ratios.cat = {};
    /* salesVelocity_ الحيّة بترجّع items بالاسم = [كمية، إيراد السطر] + rev.
       نسخة أقدم بنفس الاسم كانت بتترجّع byCode/rev وبتتغطي، فالأرقام كانت صفر. */
    var vel = { days: 0, rev: 0, files: 0, items: null };
    try {
      var vv = salesVelocity_();
      if (vv && typeof vv === 'object') {
        vel = { days: vv.days || 0, rev: vv.rev || 0, files: vv.files || 0, items: vv.items || null };
      }
    } catch (e3) { vel = { days: 0, rev: 0, files: 0, items: null }; }
    var salesDays = vel.files > 0 ? (vel.days || 0) : 0;
    var openMs = {};   // مفتاح الصنف → أول ما ظهر ناقص (من سجل النواقص)
    try {
      var esh = getOrCreateSheet_(SHORT_EP_SHEET, SHORT_EP_HEAD), en = esh.getLastRow() - 1;
      if (en > 0) esh.getRange(2, 1, en, SHORT_EP_HEAD.length).getValues().forEach(function (r) {
        if (r[7] === 'قائم') openMs[String(r[0])] = Number(r[11]);
      });
    } catch (e4) {}
    var nowMs = new Date().getTime();

    function num_(v) { var x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(x) ? x : null; }
    /* بندوّر في حقول الصنف على السعر/التكلفة/الخصم بأسمائها مهما اتكتبت */
    function pick_(it, re, notRe) {
      var ks = Object.keys(it);
      for (var i = 0; i < ks.length; i++) {
        if (re.test(ks[i]) && !(notRe && notRe.test(ks[i]))) { var v = num_(it[ks[i]]); if (v !== null && v > 0) return v; }
      }
      return null;
    }

    var out = { ok: true, days: dd, at: Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'),
                sourceFields: null, estimated: 0, total: 0, restocked: 0, salesDays: salesDays,
                revPerDay: salesDays > 0 ? Math.round((vel.rev || 0) / salesDays) : 0 };
    ['zero', 'low'].forEach(function (sec) {
      var by = {}, data = d[sec];
      if (data && data.categories) {
        Object.keys(data.categories).forEach(function (cat) {
          var comps = data.categories[cat];
          Object.keys(comps).forEach(function (co) {
            (by[co] = by[co] || []);
            comps[co].forEach(function (it) {
              if (!out.sourceFields) out.sourceFields = Object.keys(it);
              var q = Math.ceil(Number(it.shortage) - 1e-9);
              if (!isFinite(q) || q < 1) q = 1;

              var pub = pick_(it, /price|سعر|retail|sell|public|جمهور/i, /after|cost|coast|net|buy|purchase|disc/i);
              if (pub === null) {
                var sc = byCode[String(it.code || '').replace(/[^\d]/g, '')];
                pub = sc ? sc.price : (byName[doctorNorm_(it.name)] || null);
              }
              /* الرصيد الحالي: من الصنف نفسه لو موجود، وإلا من المخزون بالكود ثم بالاسم */
              var stk = null;
              var ks_ = Object.keys(it);
              for (var z = 0; z < ks_.length && stk === null; z++) {
                if (/stock|رصيد|qty|balance/i.test(ks_[z]) && !/max|min|need|short/i.test(ks_[z])) stk = num_(it[ks_[z]]);
              }
              /* الرصيد الحيّ من STOCK LIVE (بيتحدّث كل ~5 دقايق) — قايمة النواقص نفسها بتتحدّث أبطأ،
                 فلو الصنف دخل المخزون بعد آخر تصدير نشيله/نصحّح رصيده بدل ما يفضل ظاهر ناقص */
              var sc2 = byCode[String(it.code || '').replace(/[^\d]/g, '')];
              var live = sc2 ? sc2.stock : (stByName[doctorNorm_(it.name)] !== undefined ? stByName[doctorNorm_(it.name)] : null);
              live = (live === null || live === undefined || !isFinite(Number(live))) ? null : Number(live);
              if (live !== null) {
                if (sec === 'zero' && live > 0) { out.restocked++; return; }
                if (stk !== null && live >= stk + Number(it.shortage || 0) - 1e-9 && live > stk) { out.restocked++; return; }
                if (stk === null || live > stk) stk = live;
              }
              var cost = pick_(it, /cost|coast|net|after|buy|purchase|صيدلي|تكلف/i, /total|tot_|sum/i), est = false;
              if (cost === null && pub) {
                var disc = pick_(it, /disc|خصم|margin|ربح/i);
                if (disc !== null && disc < 100) cost = pub * (1 - disc / 100);
                else { cost = pub * (ratios.cat[cat] || ratios.all); est = true; }
              }
              /* متوسط البيع اليومي (علبة/يوم) → إيراد معرّض للضياع كل يوم نقص.
                 المطابقة بالاسم زي كفاءة الطلبيات (نفس أعمدة الفاتورة: اسم 6/5، كمية 7، سعر 8). */
              var sold = null;
              if (vel.items) {
                var vh = velLookup_(vel, it.name);
                if (vh && vh.length) sold = vh[0];
              }
              var perDay = (sold !== null && salesDays > 0) ? Math.max(0, sold) / salesDays : null;
              var fk = String(it.code || it.name || '').trim();
              var hrs = openMs[fk] ? Math.round((nowMs - openMs[fk]) / 360000) / 10 : null;
              out.total++; if (est) out.estimated++;
              by[co].push({ n: String(it.name || ''), q: q, c: cat,
                            code: String(it.code || '').replace(/[^\d]/g, ''),
                            s: stk === null ? null : Math.round(stk * 100) / 100,
                            p: pub === null ? null : Math.round(pub * 100) / 100,
                            k: cost === null ? null : Math.round(cost * 100) / 100, e: est ? 1 : 0,
                            u: perDay === null ? null : Math.round(perDay * 100) / 100,
                            v: (perDay !== null && pub) ? Math.round(perDay * pub * 10) / 10 : null, h: hrs });
            });
          });
        });
      }
      out[sec] = Object.keys(by).map(function (co) { return { co: co, items: by[co] }; })
        .sort(function (a, b) { return b.items.length - a.items.length; });
    });
    fxCachePut_(key, out, 300);
    return ordersWithMarks_(out);
  } catch (e) {
    return { ok: false, msg: e.message + ' @ ' + String(e.stack || '').split('\n').slice(0, 2).join(' | ') };
  }
}