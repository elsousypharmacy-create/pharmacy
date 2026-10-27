// ==== MODULE 64_call_results: نتايج مكالمات المتابعة (calls.html) بتتشارك بين الموظفين ====
// الشيت بيخزن مفتاح مشفّر للعميل (مش رقمه) + النتيجة + الملاحظة. من غير كلمة سر بقرار د. أحمد.
var CALLS_SHEET = 'نتايج المتابعة';
var CALL_STATUSES_ = { done: 1, noanswer: 1, later: 1, wrong: 1 };

function callsSheet_() { return getOrCreateSheet_(CALLS_SHEET, ['المفتاح', 'الحالة', 'ملاحظة', 'الوقت']); }

function callsGet_() {
  var sh = callsSheet_(), n = sh.getLastRow(), out = {};
  if (n < 2) return { ok: true, calls: out };
  sh.getRange(2, 1, n - 1, 4).getValues().forEach(function (r) {
    if (r[0] && r[1]) out[String(r[0])] = { status: String(r[1]), note: String(r[2] || ''), at: Number(r[3]) || 0 };
  });
  return { ok: true, calls: out };
}

function callsSet_(p) {
  var key = String(p.key || '');
  if (!/^[0-9a-f]{16,64}$/.test(key)) return { ok: false, error: 'مفتاح غلط' };
  var status = String(p.status || '');
  if (status && !CALL_STATUSES_[status]) return { ok: false, error: 'حالة غلط' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = callsSheet_(), n = sh.getLastRow(), row = 0;
    if (n >= 2) {
      var keys = sh.getRange(2, 1, n - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) if (String(keys[i][0]) === key) { row = i + 2; break; }
    }
    if (!status) { if (row) sh.deleteRow(row); return { ok: true }; }
    var vals = [[key, status, String(p.note || '').slice(0, 500), Date.now()]];
    if (row) sh.getRange(row, 1, 1, 4).setValues(vals); else sh.appendRow(vals[0]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ═══ قايمة المتابعة الحية: العملاء بيدخلوا ويخرجوا لوحدهم من المبيعات ═══
   الشرايح 2/3/4 من "زيارات يومية" (كل 5 دقايق). المزمن (1) من أصناف آخر 120 يوم، بيتحسب بالليل. */
var CALLS_CFG_ = {
  t4: { minVisits: 6, minDays: 30, maxDays: 60, cap: 60 },        /* منتظم غايب */
  t3: { minSpend: 5000, minDays: 45, cap: 40 },                   /* VIP منقطع */
  t2: { minVisits: 10, minDays: 14, maxDays: 120, factor: 2, cap: 60 }, /* في خطر: غاب أكتر من ضعف فاصله المعتاد */
  chronic: { windowDays: 120, minBuys: 3, gapMin: 24, gapMax: 36, overdueMin: 5, maxSince: 150 }
};
var ITEMS_SHEET = 'أصناف يومية';
var CHRONIC_SHEET = 'مزمن متأخر';

function last10_(p) { var s = String(p || '').replace(/\D/g, ''); return s.slice(-10); }
function cairoDay_(offset) { return Utilities.formatDate(new Date(Date.now() - offset * 86400000), 'Africa/Cairo', 'yyyy-MM-dd'); }
function dayNum_(iso) { var a = iso.split('-'); return Math.round(Date.UTC(+a[0], +a[1] - 1, +a[2]) / 86400000); }

/* أصناف يوم واحد: { رقم: [أصناف] } لفواتير البيع اللي عليها رقم */
function itemsDay_(folder, dateStr) {
  var files = folder.getFilesByName('sales' + dateStr + '.txt');
  if (!files.hasNext()) return {};
  var content = files.next().getBlob().getDataAsString('UTF-8');
  if (!content) return {};
  var out = {}, rx = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
  while ((m = rx.exec(content)) !== null) {
    var tuples = extractTuples('(' + m[1] + ')');
    for (var t = 0; t < tuples.length; t++) {
      try {
        var v = parseValues(tuples[t]);
        if (!v || v.length < 50) continue;
        if ((v[2] ? v[2].trim() : '') !== 'sale') continue;
        var ph = canonicalEgyptPhone_(v[45]);
        if (!ph || ph.length < 10) continue;
        var nm = String(v[6] ? v[6].trim() : (v[5] ? v[5].trim() : '')).toUpperCase().replace(/\s+/g, ' ');
        if (!nm) continue;
        var k = last10_(ph);
        if (!out[k]) out[k] = [];
        if (out[k].indexOf(nm) === -1) out[k].push(nm);
      } catch (e) { continue; }
    }
  }
  return out;
}

function capJson_(map) {
  var s = JSON.stringify(map);
  if (s.length <= 48000) return s;
  var ks = Object.keys(map), o = {};
  for (var i = 0; i < ks.length; i++) { o[ks[i]] = map[ks[i]]; if (JSON.stringify(o).length > 47000) { delete o[ks[i]]; break; } }
  return JSON.stringify(o);
}

/* بيتشغّل بتريجر كل 30 دقيقة: يكمّل الأيام الناقصة، وبعدين يحسب المزمن مرة في اليوم */
function callsChronicRefresh() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var t0 = Date.now(), cfg = CALLS_CFG_.chronic;
    var folder = DriveApp.getFolderById(SALES_FOLDER);
    var sh = getOrCreateSheet_(ITEMS_SHEET, ['التاريخ', 'أصناف']);
    sh.getRange('A:A').setNumberFormat('@');
    var stored = {};
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
        var d = String(r[0]).substring(0, 10);
        try { stored[d] = JSON.parse(r[1] || '{}'); } catch (e) { stored[d] = null; }
      });
    }
    var add = [], missing = 0;
    for (var i = cfg.windowDays; i >= 1; i--) {
      var d = cairoDay_(i);
      if (stored[d]) continue;
      if (Date.now() - t0 > 270000) { missing++; continue; }
      var map = {};
      try { map = itemsDay_(folder, d); } catch (e2) { missing++; continue; }
      add.push([d, capJson_(map)]); stored[d] = map;
    }
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 2).setValues(add);
    if (missing) return;
    var out = getOrCreateSheet_(CHRONIC_SHEET, ['التاريخ', 'JSON']);
    var today = cairoDay_(0);
    if (out.getLastRow() >= 2 && String(out.getRange(2, 1).getDisplayValue()).substring(0, 10) === today) return;
    var res = callsComputeChronic_(stored);
    out.getRange(2, 1, 1, 2).setNumberFormat('@').setValues([[today, capJson_(res)]]);
  } finally { lock.releaseLock(); }
}

function callsComputeChronic_(stored) {
  var cfg = CALLS_CFG_.chronic, todayN = dayNum_(cairoDay_(0)), per = {};
  Object.keys(stored).forEach(function (d) {
    var map = stored[d]; if (!map) return;
    var n = dayNum_(d);
    Object.keys(map).forEach(function (ph) {
      var pm = per[ph] || (per[ph] = {});
      map[ph].forEach(function (it) { (pm[it] || (pm[it] = [])).push(n); });
    });
  });
  var out = {};
  Object.keys(per).forEach(function (ph) {
    var meds = [], lastAny = 0;
    Object.keys(per[ph]).forEach(function (it) {
      var ds = per[ph][it].sort(function (a, b) { return a - b; });
      if (ds.length < cfg.minBuys) return;
      var gaps = [];
      for (var i = 1; i < ds.length; i++) gaps.push(ds[i] - ds[i - 1]);
      var sg = gaps.slice().sort(function (a, b) { return a - b; }), med = sg[Math.floor(sg.length / 2)];
      var good = gaps.filter(function (g) { return g >= 20 && g <= 40; }).length;
      if (med < cfg.gapMin || med > cfg.gapMax || good < Math.max(2, Math.ceil(gaps.length * 0.6))) return;
      var last = ds[ds.length - 1], since = todayN - last, over = since - med;
      if (over < cfg.overdueMin || since > cfg.maxSince) return;
      meds.push([it, over]); if (last > lastAny) lastAny = last;
    });
    if (meds.length) {
      meds.sort(function (a, b) { return b[1] - a[1]; });
      out[ph] = { m: meds.slice(0, 3), x: lastAny };   /* x = رقم يوم آخر شراء */
    }
  });
  return out;
}

function callsChronic_() {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(CHRONIC_SHEET);
    if (!sh || sh.getLastRow() < 2) return {};
    return JSON.parse(sh.getRange(2, 2).getValue() || '{}');
  } catch (e) { return {}; }
}

/* القايمة كلها (متخزنة 5 دقايق) */
function callsList_() {
  var hit = fxCacheGet_('fx_calllist'); if (hit) return hit;
  fxClearCache_('fx_cvis_365');   /* عشان مبيعات النهاردة تظهر في خلال 5 دقايق مش 30 */
  var vis = getCustomerVisits(365);
  if (!vis || !vis.ok) return { ok: false, error: (vis && vis.error) || 'تعذر قراءة الزيارات' };
  var names = {}, blocked = {};
  try {
    getCustomers().forEach(function (c) {
      var k = last10_(c.phone); names[k] = c.name || '';
      if (c.is_blocked) blocked[k] = 1;
    });
  } catch (e) {}
  var chronic = callsChronic_(), C = CALLS_CFG_, todayN = dayNum_(cairoDay_(0)), rows = [], b = { 2: [], 3: [], 4: [] };
  Object.keys(vis.customers).forEach(function (ph) {
    var a = vis.customers[ph], k = last10_(ph);
    if (k.length < 10 || blocked[k] || !a.l) return;
    var d = todayN - dayNum_(a.l);
    var row = { n: names[k] || '', p: '0' + k, l: a.l, d: d, v: a.v, s: a.s, m: [], o: [], c: 2, b: 0 };
    var ch = chronic[k];
    if (ch && dayNum_(a.l) <= ch.x) {                       /* لسه ماشتراش بعد آخر مرة */
      row.t = 1; row.c = 1; row.m = ch.m; rows.push(row); return;
    }
    if (a.s >= C.t3.minSpend && d >= C.t3.minDays) { row.t = 3; b[3].push(row); return; }
    if (a.v >= C.t2.minVisits && d >= C.t2.minDays && d <= C.t2.maxDays && d > C.t2.factor * (365 / a.v)) { row.t = 2; b[2].push(row); return; }
    if (a.v >= C.t4.minVisits && d >= C.t4.minDays && d <= C.t4.maxDays) { row.t = 4; b[4].push(row); }
  });
  [2, 3, 4].forEach(function (t) {
    b[t].sort(function (x, y) { return y.s - x.s; });
    rows = rows.concat(b[t].slice(0, C['t' + t].cap));
  });
  rows.sort(function (x, y) { return x.t - y.t || y.s - x.s; });
  var out = { ok: true, at: Date.now(), partial: !!vis.missingDays, list: rows };
  fxCachePut_('fx_calllist', out, 300);
  return out;
}
