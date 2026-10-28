// ==== MODULE 64_call_results: نتايج مكالمات المتابعة (calls.html) بتتشارك بين الموظفين ====
// الشيت بيخزن مفتاح مشفّر للعميل (مش رقمه) + النتيجة + الملاحظة. من غير كلمة سر بقرار د. أحمد.
var CALLS_SHEET = 'نتايج المتابعة';
var CALL_STATUSES_ = { done: 1, noanswer: 1, later: 1, wrong: 1 };

function callsSheet_() {
  var sh = getOrCreateSheet_(CALLS_SHEET, ['المفتاح', 'الحالة', 'ملاحظة', 'الوقت', 'الموظف']);
  if (sh.getLastColumn() < 5) sh.getRange(1, 5).setValue('الموظف');
  return sh;
}

function callsGet_() {
  var sh = callsSheet_(), n = sh.getLastRow(), out = {};
  if (n < 2) return { ok: true, calls: out };
  sh.getRange(2, 1, n - 1, 5).getValues().forEach(function (r) {
    if (r[0] && r[1]) out[String(r[0])] = { status: String(r[1]), note: String(r[2] || ''), at: Number(r[3]) || 0, by: String(r[4] || '') };
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
    var vals = [[key, status, String(p.note || '').slice(0, 500), Date.now(), String(p.by || '').trim().slice(0, 40)]];
    if (row) sh.getRange(row, 1, 1, 5).setValues(vals); else sh.appendRow(vals[0]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ═══ قايمة المتابعة الحية: العملاء بيدخلوا ويخرجوا لوحدهم من المبيعات ═══
   الشرايح 2/3/4 من "زيارات يومية" (كل 5 دقايق). المزمن (1) من أصناف آخر 120 يوم، بيتحسب بالليل. */
var CALLS_CFG_ = {
  lapsed: { minDays: 30, minVisits: 2, vipSpend: 5000 },          /* باقي الغايبين: غاب 30 يوم+ وزار مرتين+ ، و VIP لو صرف 5000+ */
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
  var chronic = callsChronic_(), C = CALLS_CFG_, todayN = dayNum_(cairoDay_(0)), rows = [], rest = [], evMap = {};
  eventRows_().forEach(function (r) {
    var k = last10_(r[2]); if (k.length !== 10) return;
    var reg = String(r[0]).substring(0, 10);
    evMap[k] = { n: r[1], p: '0' + k, t: 3, l: reg, reg: reg, d: todayN - dayNum_(reg), v: 0, s: 0, m: [], o: [], c: 2, b: 0,
                 g: String(r[3] || ''), x: String(r[4] || '') };
  });
  Object.keys(vis.customers).forEach(function (ph) {
    var a = vis.customers[ph], k = last10_(ph);
    if (k.length < 10 || blocked[k] || !a.l) return;
    var d = todayN - dayNum_(a.l);
    var row = { n: names[k] || '', p: '0' + k, l: a.l, d: d, v: a.v, s: a.s, m: [], o: [], c: 2, b: 0, vip: a.s >= C.lapsed.vipSpend ? 1 : 0 };
    var ch = chronic[k];
    if (ch && dayNum_(a.l) <= ch.x) {                       /* لسه ماشتراش بعد آخر مرة */
      row.t = 1; row.c = 1; row.m = ch.m; rows.push(row); delete evMap[k]; return;
    }
    if (evMap[k]) { evMap[k].v = a.v; evMap[k].s = a.s; evMap[k].vip = row.vip; if (a.l > evMap[k].reg) evMap[k].bought = 1; return; }
    if (d >= C.lapsed.minDays && a.v >= C.lapsed.minVisits) { row.t = 2; rest.push(row); }
  });
  var evList = [];
  Object.keys(evMap).forEach(function (k) { var e = evMap[k]; if (!e.bought && !blocked[k]) { delete e.bought; delete e.reg; evList.push(e); } });
  evList.sort(function (x, y) { return y.d - x.d; });
  rest.sort(function (x, y) { return y.s - x.s; });
  rows.sort(function (x, y) { return y.m[0][1] - x.m[0][1]; });
  rows = rows.concat(evList, rest);
  var out = { ok: true, at: Date.now(), partial: !!vis.missingDays, list: rows };
  fxCachePut_('fx_calllist', out, 300);
  return out;
}

/* مفتاح العميل في شيت النتايج = أول 16 بايت هيكس (32 حرف) من SHA-256 (آخر 10 أرقام) — نفس حساب الصفحة */
function callsKey_(p) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'calls|' + last10_(p), Utilities.Charset.UTF_8), h = '';
  for (var i = 0; i < 16; i++) h += ('0' + ((b[i] + 256) % 256).toString(16)).slice(-2);
  return h;
}

/* تقرير المتابعة للداشبورد */
function callsReport_() {
  var L = callsList_();
  if (!L || !L.ok) return { ok: false, error: (L && L.error) || 'تعذر قراءة القايمة' };
  var byKey = {}, tiers = { 1: 0, 2: 0, 3: 0 };
  L.list.forEach(function (r) { byKey[callsKey_(r.p)] = r; tiers[r.t] = (tiers[r.t] || 0) + 1; });
  var res = callsGet_().calls, today = cairoDay_(0), cnt = { done: 0, noanswer: 0, later: 0, wrong: 0, blocked: 0 },
      td = { done: 0, noanswer: 0, later: 0, wrong: 0, blocked: 0 }, recent = [], open = 0, staff = {};
  Object.keys(res).forEach(function (k) {
    var v = res[k], r = byKey[k];
    if (cnt[v.status] === undefined) return;
    cnt[v.status]++;
    var day = v.at ? Utilities.formatDate(new Date(v.at), 'Africa/Cairo', 'yyyy-MM-dd') : '';
    if (day === today) {
      td[v.status]++;
      var who = v.by || 'بدون اسم';
      staff[who] = staff[who] || { name: who, n: 0, done: 0 };
      staff[who].n++; if (v.status === 'done') staff[who].done++;
    }
    recent.push({ n: r ? r.n : '', p: r ? r.p : '', t: r ? r.t : 0, status: v.status, note: v.note, at: v.at, by: v.by, out: r ? 0 : 1 });
  });
  recent.sort(function (a, b) { return b.at - a.at; });
  /* لسه محدش كلمهم: اللي في القايمة وماعندهمش نتيجة */
  L.list.forEach(function (r) { if (!res[callsKey_(r.p)]) open++; });
  var staffList = Object.keys(staff).map(function (k) { return staff[k]; }).sort(function (a, b) { return b.n - a.n; });
  return { ok: true, total: L.list.length, tiers: tiers, left: open, all: cnt, today: td, staff: staffList, recent: recent.slice(0, 40) };
}

/* 📨 ملخص المكالمات اليومي على تليجرام (تريجر الساعة 10 بالليل) */
function callsDailySummary() {
  var r = callsReport_();
  if (!r || !r.ok) return;
  var t = r.today, all = t.done + t.noanswer + t.later + t.wrong + t.blocked;
  var today = cairoDay_(0);
  var lines = ['📞 ملخص مكالمات المتابعة — ' + today,
    'اتعمل النهاردة: ' + all + ' مكالمة',
    '✅ اتكلمنا ' + t.done + ' · 📵 مردش ' + t.noanswer + ' · 🕒 موعد تاني ' + t.later + ' · ❌ رقم غلط ' + t.wrong + (t.blocked ? ' · 🚫 حظر ' + t.blocked : ''),
    'لسه محتاجين مكالمة: ' + r.left + ' من ' + r.total];
  if (r.staff.length) lines.push('', '👩‍⚕️ حسب الموظفة:', r.staff.map(function (s) { return '• ' + s.name + ': ' + s.n + ' (اتكلمنا ' + s.done + ')'; }).join('\n'));
  var notes = r.recent.filter(function (x) {
    return x.note && x.at && Utilities.formatDate(new Date(x.at), 'Africa/Cairo', 'yyyy-MM-dd') === today;
  }).slice(0, 10);
  if (notes.length) lines.push('', '📝 ملاحظات النهاردة:', notes.map(function (x) { return '• ' + (x.n || x.p || 'عميل') + ': ' + x.note; }).join('\n'));
  if (!all) lines.push('', '⚠️ محدش عمل أي مكالمة النهاردة.');
  sendTelegramStaff(lines.join('\n'), PERSONAL_CHAT);
}

/* ═══ ايفنت المعاشات: الممرض بيسجل الاسم والرقم + اختيار سريع، وبيدخلوا قايمة المكالمات كشريحة 3 ═══ */
var EVENT_SHEET = 'ايفنت المعاشات';
var EVENT_TAGS_ = { 'ضغط': 1, 'سكر': 1, 'القراية عالية': 1, 'طبيعي': 1, 'عايز توصيل': 1 };
function eventSheet_() {
  var sh = getOrCreateSheet_(EVENT_SHEET, ['الوقت', 'الاسم', 'الرقم', 'اختيارات', 'ملاحظة']);
  sh.getRange('C:C').setNumberFormat('@');
  return sh;
}
function eventAdd_(p) {
  var name = String(p.name || '').trim().slice(0, 80);
  var k = last10_(p.phone);
  if (!name) return { ok: false, error: 'اكتب الاسم' };
  if (k.length !== 10 || k.charAt(0) !== '1') return { ok: false, error: 'الرقم غلط — لازم 11 رقم يبدأ بـ 01' };
  var tags = String(p.tags || '').split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return EVENT_TAGS_[s]; }).join('، ');
  var note = String(p.note || '').trim().slice(0, 300);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = eventSheet_(), n = sh.getLastRow(), row = 0, now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm');
    if (n >= 2) {
      var ph = sh.getRange(2, 3, n - 1, 1).getDisplayValues();
      for (var i = 0; i < ph.length; i++) if (last10_(ph[i][0]) === k) { row = i + 2; break; }
    }
    var vals = [now, name, '0' + k, tags, note];
    if (row) sh.getRange(row, 1, 1, 5).setValues([vals]); else sh.appendRow(vals);
    fxClearCache_('fx_calllist');
    return { ok: true, updated: !!row, total: row ? n - 1 : n };
  } finally { lock.releaseLock(); }
}
function eventRows_() {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(EVENT_SHEET);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues();
  } catch (e) { return []; }
}
