// ==== MODULE 63_expenses (split from server/Code.js; load order = file name order) ====


// ═══════════════════════════════════════════════════════════════════
// 💸 المصروفات — قراءة مباشرة من ملفات Drive
//
// ⚠️ ليه اتغيّرت:
// السلسلة القديمة كانت 3 خطوات: نظام البيع → xlsx على Drive →
// شيت جوجل → الداشبورد. الخطوة الوسطانية (التحويل للشيت) وقفت
// يوم 2 أغسطس من غير ما حد يلاحظ، فالداشبورد فضل يعرض بيانات
// عمرها 9 أيام وكأنها صح.
//
// دلوقتي بنقرا الـxlsx من Drive مباشرة — نفس اللي بنعمله مع ملفات
// المبيعات الخام من شهور. خطوة أقل = نقطة فشل أقل.
//
// ⚠️ تصحيح: Expenses_*.xlsx مش تراكمي. كل نسخة فيها الحركات من آخر
// تقفيل بس (يومين-تلاتة)، واللي اتقفل بيختفي من النسخة الجاية. ولما
// التصدير بيقف أو بيطلع متقطع، الأيام اللي بينهم مالهاش نسخة خالص.
// عشان كده: (١) كل ما نقرا الملف نحفظ حركاته في أرشيف دائم بالتسلسل،
// (٢) وبنسجّل إجمالي المصروفات المتنوعة اليومي من Daily_Mini_Statics
//     (بيتحدّث لحظي) ونكمّل بيه أي يوم ناقص.
// ═══════════════════════════════════════════════════════════════════

var EXPORT_FOLDER = '1Vq85t_jS3sS4s0JHjP5uo3nHZxOAltpb';

/* بيلاقي أحدث ملف مصروفات وبيحوّله لصفوف */
/* تحويل ملف xlsx واحد لصفوف — Drive REST مباشرة (من غير تفعيل خدمة متقدمة) */
function xlsxToRows_(file) {
  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + file.getId() +
    '/copy?fields=id&supportsAllDrives=true',
    { method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ name: '__tmp_exp_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS }),
      muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    var why = ''; try { why = JSON.parse(res.getContentText()).error.message; } catch (e) { why = res.getContentText().slice(0, 150); }
    return { ok: false, error: 'تحويل الملف فشل: ' + res.getResponseCode() + (why ? ' — ' + why : '') };
  }
  var tmpId = JSON.parse(res.getContentText()).id, rows = [];
  try {
    var sh = SpreadsheetApp.openById(tmpId).getSheets()[0];
    if (sh.getLastRow() > 1) rows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  } finally {
    try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {}
  }
  return { ok: true, rows: rows };
}

/* بيلاقي أحدث ملف مصروفات وبيحوّله لصفوف */
function readExpenseFile_() {
  try {
    var folder = DriveApp.getFolderById(EXPORT_FOLDER);
    var files = folder.getFilesByName('Expenses_9882-3C97_1.xlsx');
    var newest = null;
    while (files.hasNext()) {
      var f = files.next();
      if (!newest || f.getLastUpdated() > newest.getLastUpdated()) newest = f;
    }
    if (!newest) return { ok: false, error: 'ملف المصروفات مش موجود' };
    var r = xlsxToRows_(newest);
    if (!r.ok) return r;
    return { ok: true, rows: r.rows,
             at: Utilities.formatDate(newest.getLastUpdated(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* بيحوّل صفوف الملف لسطور مصروفات موحّدة */
function parseExpenseRows_(rows) {
  if (!rows || rows.length < 2) return [];
  var hdr = rows[0].map(function (h) { return String(h || '').trim(); });
  var ix = {};
  hdr.forEach(function (h, i) { ix[h] = i; });

  /* الأعمدة بالاسم مش بالرقم — النظام بيغيّر الترتيب أحيانًا */
  var cType = (ix['النوع']   !== undefined) ? ix['النوع']   : 3;
  var cVal  = (ix['القيمة']  !== undefined) ? ix['القيمة']  : 4;
  var cTime = (ix['الوقـت']  !== undefined) ? ix['الوقـت']  : 5;
  var cName = (ix['المصروفات']!== undefined) ? ix['المصروفات']: 1;
  var cDet  = (ix['التفاصيل'] !== undefined) ? ix['التفاصيل'] : 2;
  var cId   = (ix['التسلسل']  !== undefined) ? ix['التسلسل']  : 0;
  var cComp = (ix['الشركة']    !== undefined) ? ix['الشركة']    : -1;
  var cStaff= (ix['اسم الموظف']!== undefined) ? ix['اسم الموظف']: -1;

  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];

    /* ⚠️ إصلاح الزحلقة:
       لما خانة "التفاصيل" تبقى فاضية، بعض المصادر بتسقطها خالص
       بدل ما تسيبها فاضية — فكل الأعمدة بتتزحلق مكان لورا.
       مثال حقيقي (مصروفات متنوعة):
         الصح:   2929 | صور فوتير | (فاضي) | مصروفات متنوعة | 20 | 2026-08-01
         المكسور: 2929 | صور فوتير | مصروفات متنوعة | 20 | 2026-08-01
       فالوقت كان بيتقرا "20" بدل التاريخ، والسطر يتفلتر ويختفي.

       الحل: بندوّر على التاريخ في الصف كله بدل ما نثق في رقم العمود. */
    var shift = 0;
    var tsRaw = String(r[cTime] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(tsRaw)) {
      for (var k = 0; k < r.length; k++) {
        if (/^\d{4}-\d{2}-\d{2}[ T]/.test(String(r[k] || '').trim())) {
          shift = k - cTime;   /* بكام خانة اتزحلق الصف */
          break;
        }
      }
    }
    function col(base) {
      var v = r[base + shift];
      return (v === undefined || v === null) ? '' : String(v).trim();
    }

    var cat = col(cType);
    if (!cat) continue;
    var ts = col(cTime).substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ts)) continue;
    out.push({
      id: String(r[cId] || ''),           /* التسلسل قبل الزحلقة دايمًا */
      category: cat,
      amount: parseFloat(col(cVal).replace(/,/g, '')) || 0,
      date: ts,
      time: col(cTime).substring(11, 16),
      name: col(cName),
      detail: shift ? '' : col(cDet),     /* الزحلقة معناها التفاصيل فاضية */
      company: (cComp !== -1) ? col(cComp) : '',
      staff: (cStaff !== -1) ? col(cStaff) : '',
      /* الإيراد مش مصروف — بيتفلتر في الحسابات وبيتعرض لوحده */
      isIncome: cat.indexOf('ايراد') === 0
    });
  }
  return out;
}

/* أرشيف الشيت — للشهور القديمة اللي مش في الملف الحالي */
function readExpenseSheet_() {
  var out = [];
  try {
    var ss = SpreadsheetApp.openById(EXPENSES_SHEET_ID);
    ['Daily_Expenses', 'Monthly_Expenses'].forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() <= 1) return;
      var rows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
      out = out.concat(parseExpenseRows_(rows));
    });
  } catch (e) {}
  return out;
}

/* المصدر الموحّد: الملف الحي + الأرشيف، من غير تكرار */
var EXP_LEDGER_SHEET  = 'سجل يومي للمصروفات';
var EXP_ARCHIVE_SHEET = 'أرشيف المصروفات';

/* نوع الحركة: المتنوعة (الوحيدة اللي بنكمّلها من السجل) أو المشتروات */
function expKind_(cat) {
  cat = String(cat || '');
  if (cat.indexOf('متنوعة') !== -1) return 'misc';
  if (cat.indexOf('مشتروات') !== -1) return 'purch';
  return '';
}

/* "09/10/2026 - 11:45 PM" → "2026-10-09". لو مش مفهوم بنرجّع فاضي ومبنخمّنش */
function statsDay_(s) {
  var m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}

/* حفظ دائم لحركات الملف بالتسلسل. الملف بيشيل اللي اتقفل، فلو متحفظش هنا بيضيع. */
function archiveExpenses_(items) {
  if (!items || !items.length) return 0;
  var sh = getOrCreateSheet_(EXP_ARCHIVE_SHEET,
    ['التسلسل', 'النوع', 'القيمة', 'التاريخ', 'الوقت', 'المصروف', 'التفاصيل', 'الشركة', 'الموظف', 'إيراد', 'أُضيف']);
  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('D:D').setNumberFormat('@');
  var seen = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) { seen[String(r[0])] = 1; });
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss'), rows = [];
  items.forEach(function (e) {
    if (!e.id || seen[e.id]) return;
    seen[e.id] = 1;
    rows.push([e.id, e.category, e.amount, e.date, e.time || '', e.name || '', e.detail || '',
               e.company || '', e.staff || '', e.isIncome ? 1 : 0, now]);
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 11).setValues(rows);
  return rows.length;
}

function readExpenseArchive_() {
  var out = [];
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(EXP_ARCHIVE_SHEET);
    if (!sh || sh.getLastRow() <= 1) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, 10).getDisplayValues().forEach(function (r) {
      out.push({ id: String(r[0]), category: r[1],
                 amount: parseFloat(String(r[2]).replace(/,/g, '')) || 0,
                 date: String(r[3]).substring(0, 10), time: r[4], name: r[5], detail: r[6],
                 company: r[7], staff: r[8], isIncome: String(r[9]) === '1' });
    });
  } catch (e) {}
  return out;
}

/* السجل اليومي: كل ساعة بنكتب إجمالي النهاردة وإمبارح من Daily_Mini_Statics.
   "اليوم" هنا هو يوم الإحصائية نفسها (مش يوم السكربت) — لو الجهاز اتأخر في
   التحديث مبنسجّلش بيانات يوم على يوم تاني. */
function recordDailyStats_() {
  var t = getSystemDailyTotals();
  if (!t || !t.ok) return { ok: false, error: 'الإحصائيات مش متاحة' };
  var day = statsDay_(t.updated_at);
  if (!day) return { ok: false, error: 'مقدرتش أفهم تاريخ الإحصائية: ' + t.updated_at };
  var prev = Utilities.formatDate(new Date(new Date(day + 'T12:00:00').getTime() - 86400000), 'Africa/Cairo', 'yyyy-MM-dd');

  var sh = getOrCreateSheet_(EXP_LEDGER_SHEET, ['التاريخ', 'مصروفات متنوعة', 'مشتروات الشركات', 'آخر تحديث', 'مصدر']);
  sh.getRange('A:A').setNumberFormat('@');
  var rowOf = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r, i) { rowOf[String(r[0]).substring(0, 10)] = i + 2; });
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss'), written = 0;
  function upsert(d, misc, purch, src) {
    var vals = [[d, misc, purch, now, src]];
    if (rowOf[d]) sh.getRange(rowOf[d], 1, 1, 5).setValues(vals);
    else { sh.getRange(sh.getLastRow() + 1, 1, 1, 5).setValues(vals); rowOf[d] = sh.getLastRow(); }
    written++;
  }
  upsert(prev, t.misc_yesterday || 0, t.purch_yesterday || 0, 'أمس');
  upsert(day,  t.misc_today || 0,     t.purch_today || 0,     'النهاردة');
  fxClearCache_('fx_exp_all');
  return { ok: true, day: day, written: written, misc_today: t.misc_today, misc_yesterday: t.misc_yesterday };
}

function readLedger_() {
  var out = [];
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(EXP_LEDGER_SHEET);
    if (!sh || sh.getLastRow() <= 1) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
      var day = String(r[0] || '').substring(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      out.push({ day: day, misc: parseFloat(String(r[1]).replace(/,/g, '')) || 0,
                 purch: parseFloat(String(r[2]).replace(/,/g, '')) || 0 });
    });
  } catch (e) {}
  return out;
}

/* بيكمّل المتنوعة بالفرق عن إجمالي النظام اليومي.
   ⚠️ المتنوعة بس — المشتريات مبنكمّلهاش لأني مش متأكد إن تعريف "مشتروات
   الشركات" في إحصائيات النظام نفس اللي في ملف المصروفات، ولو اختلف هنضيف
   فروق وهمية. المتنوعة هي اللي بتدخل في حساب الربح الصافي. */
function applyLedger_(items, ledger) {
  var sums = {};
  items.forEach(function (e) {
    if (e.isIncome) return;
    if (expKind_(e.category) !== 'misc') return;
    sums[e.date] = (sums[e.date] || 0) + e.amount;
  });
  var extra = [];
  ledger.forEach(function (L) {
    var have = sums[L.day] || 0;
    var diff = Math.round((L.misc - have) * 100) / 100;
    if (diff > 0.5) {
      extra.push({ id: 'L-' + L.day + '-misc', category: 'مصروفات متنوعة', amount: diff,
                   date: L.day, time: '',
                   name: have > 0 ? 'فرق غير مفصّل (إجمالي اليوم من النظام)' : 'إجمالي اليوم من النظام',
                   detail: '', company: '', staff: '', isIncome: false, fromLedger: true });
    }
  });
  return items.concat(extra);
}

/* ملفات التصدير بفترة يدوية "Expenses From ..." — بتتحوّل مرة لكل نسخة وتتحفظ في الأرشيف */
function ingestPeriodExpenseFiles_() {
  var props = PropertiesService.getScriptProperties(), added = 0, items = [];
  var done = {};
  try { done = JSON.parse(props.getProperty('exp_period_done') || '{}'); } catch (e) {}
  var it = DriveApp.searchFiles("title contains 'Expenses From' and trashed = false");
  var n = 0;
  while (it.hasNext() && n < 10) {
    var f = it.next(); n++;
    if (!/\.xlsx$/i.test(f.getName())) continue;
    var sig = String(f.getLastUpdated().getTime());
    if (done[f.getId()] === sig) continue;
    var r = xlsxToRows_(f);
    if (!r.ok) continue;
    items = items.concat(parseExpenseRows_(r.rows));
    done[f.getId()] = sig;
  }
  if (items.length) added = archiveExpenses_(items);
  props.setProperty('exp_period_done', JSON.stringify(done));
  return added;
}

/* ملفات "Company Paid Expenses" الشهرية: بتسد فجوة المشتروات بعد آخر مشتروات مفصّلة حقيقية */
function readCompanyPaid_() {
  var out = [];
  try {
    var cache = fxCacheGet_('fx_cpaid');
    if (cache) return cache;
    var it = DriveApp.searchFiles("title contains 'Company Paid Expenses' and trashed = false");
    var files = [];
    while (it.hasNext()) files.push(it.next());
    files.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
    files.slice(0, 2).forEach(function (f) {
      var r = xlsxToRows_(f);
      if (!r.ok) return;
      r.rows.slice(1).forEach(function (row) {
        var cname = String(row[2] || '').trim();
        var det = String(row[5] || '');
        var re = /invoice:(\d+)\s+paid:([\d.]+)\s+at:(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/g, m;
        while ((m = re.exec(det))) {
          if (m[1] === '0') continue;   /* دفعات من غير فاتورة مش مشتروات */
          out.push({ id: 'CP-' + m[1] + '-' + m[3] + m[4] + '-' + m[2], category: 'مصروفات مشتروات شركات',
                     amount: parseFloat(m[2]) || 0, date: m[3], time: m[4],
                     name: (cname || 'الصيدلية') + ',' + m[1], detail: '', company: cname, staff: '',
                     isIncome: false, fromCompanyPaid: true });
        }
      });
    });
    fxCachePut_('fx_cpaid', out, 1800);
  } catch (e) {}
  return out;
}

/* ═══ المصروفات من النسخة الاحتياطية لـ Pharmaclick ═══
   الإكسبورت وقف من 4 أكتوبر، لكن الباك أب (كل 3–4 ساعات) فيه جدول expenses كامل.
   التسلسل في الباك أب = نفس "التسلسل" في الإكسبورت القديم، فمفيش تكرار في الأرشيف.
   out = مصروفات متنوعة · pay = مشتروات شركات · salary = مرتبات · debits = ايراد مديونيات */
var EXP_TYPE_CAT_ = { out: 'مصروفات متنوعة', pay: 'مصروفات مشتروات شركات', salary: 'مصروفات مرتبات', debits: 'ايراد مديونيات' };
function syncExpensesFromBackup_(force) {
  var P = PropertiesService.getScriptProperties();
  var it = DriveApp.searchFiles("title contains 'pharmaclick_backup_9882' and trashed = false"), newest = null;
  while (it.hasNext()) { var f = it.next(); if (!newest || f.getLastUpdated() > newest.getLastUpdated()) newest = f; }
  if (!newest) return { ok: false, error: 'مفيش نسخة احتياطية' };
  var sig = newest.getId() + '|' + newest.getLastUpdated().getTime();
  if (!force && P.getProperty('exp_bk_sig') === sig) return { ok: true, skipped: true, file: newest.getName() };
  var blob = newest.getBlob(); blob.setContentType('application/zip');
  var sql = '';
  Utilities.unzip(blob).forEach(function (e) { if (!sql && /\.sql$/i.test(e.getName())) sql = e.getDataAsString('UTF-8'); });
  if (!sql) return { ok: false, error: 'ملف SQL مش موجود في النسخة' };

  function table(name) {
    var cols = sqlColumns_(sql, name), rows = sqlTableRows_(sql, name).rows;
    return rows.map(function (x) { var v = sqlVals_(x), o = {}; cols.forEach(function (c, i) { o[c] = v[i]; }); return o; });
  }
  var users = {}, comps = {};
  table('users').forEach(function (u) { users[u.id] = u.name || ''; });
  table('companies').forEach(function (c) { comps[c.id] = c.namear || c.name || ''; });
  var exp = table('expenses');
  sql = null;   /* نفضّي الذاكرة */

  var items = [];
  exp.forEach(function (r) {
    if (String(r.deleted) === '1') return;
    var cat = EXP_TYPE_CAT_[r.type]; if (!cat) return;
    var ts = String(r.time || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(ts)) return;
    items.push({ id: String(r.id), category: cat, amount: parseFloat(r.value) || 0,
                 date: ts.slice(0, 10), time: ts.slice(11, 16),
                 name: String(r.title || '').replace(/,\d+,دفع مباشر$/, ''), detail: String(r.details || '').trim(),
                 company: (+r.companyid > 3 ? comps[r.companyid] || '' : ''), staff: users[r.userid] || '',
                 isIncome: r.type === 'debits' });
  });
  var added = archiveExpenses_(items);
  P.setProperty('exp_bk_sig', sig);
  P.setProperty('exp_bk_last', JSON.stringify({ at: Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'),
    file: newest.getName(), rows: items.length, added: added }));
  fxClearCache_('fx_exp_all');
  return { ok: true, file: newest.getName(), rows: items.length, added: added,
           lastDate: items.reduce(function (m, x) { return x.date > m ? x.date : m; }, '') };
}
function syncExpensesFromBackup() { return syncExpensesFromBackup_(false); }   /* للتريجر */
function ensureExpenseBackupTrigger_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('exp_bk_trigger') === '1') return false;
  var has = ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === 'syncExpensesFromBackup'; });
  if (!has) ScriptApp.newTrigger('syncExpensesFromBackup').timeBased().everyHours(2).create();
  P.setProperty('exp_bk_trigger', '1');
  return true;
}

/* المصدر الموحّد: الملف الحي + الأرشيف الدائم + الشيتات القديمة + السجل اليومي */
function allExpenses_() {
  var hit = fxCacheGet_('fx_exp_all');
  if (hit) return hit;
  /* أول مرة: نركّب التحديث التلقائي كل ساعتين ونسحب من الباك أب على طول */
  try { if (ensureExpenseBackupTrigger_()) syncExpensesFromBackup_(true); } catch (e) { Logger.log('exp backup: ' + e.message); }

  var file = readExpenseFile_();
  var live = (file.ok) ? parseExpenseRows_(file.rows) : [];
  try { if (live.length) archiveExpenses_(live); } catch (e) {}
  try { ingestPeriodExpenseFiles_(); } catch (e) {}

  var seen = {}, merged = [];
  live.concat(readExpenseArchive_()).concat(readExpenseSheet_()).forEach(function (e) {
    var k = e.id ? ('#' + e.id) : (e.date + '|' + e.category + '|' + e.amount + '|' + e.name);
    if (seen[k]) return;
    seen[k] = 1; merged.push(e);
  });

  /* آخر حركة مفصّلة حقيقية — قبل ما السجل يضيف صفوفه التكميلية */
  merged.sort(function (a, b) { return b.date.localeCompare(a.date); });
  var latestItem = merged.length ? merged[0].date : '';

  /* سد فجوة المشتروات من ملف المدفوعات للشركات (بعد آخر مشتروات حقيقية فقط) */
  var lastPurch = '';
  merged.forEach(function (e) { if (!e.isIncome && expKind_(e.category) === 'purch' && e.date > lastPurch) lastPurch = e.date; });
  var cp = readCompanyPaid_().filter(function (e) { return e.date > lastPurch; });
  merged = merged.concat(cp);

  var ledger = readLedger_();
  merged = applyLedger_(merged, ledger);
  merged.sort(function (a, b) { return b.date.localeCompare(a.date); });

  /* "واقفة" = مفيش أي إشارة حياة: لا حركة مفصّلة ولا سجل يومي حديث.
     قبل كده كانت بتبص على آخر حركة بس، فيوم من غير مصروفات كان بيبان كأن
     التصدير واقف. */
  var latestLedger = ledger.reduce(function (m, L) { return L.day > m ? L.day : m; }, '');
  var latest = (latestLedger > latestItem) ? latestLedger : latestItem;

  var out = {
    ok: true, items: merged,
    fileAt: file.ok ? file.at : '',
    fileError: file.ok ? '' : file.error,
    latestEntry: latest,
    latestItemized: latestItem,
    itemizedStaleDays: latestItem
      ? Math.floor((new Date(Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd'))
                    - new Date(latestItem)) / 86400000)
      : null,
    companyPaidFrom: lastPurch,
    companyPaidRows: cp.length,
    ledgerDays: ledger.length,
    staleDays: latest
      ? Math.floor((new Date(Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd'))
                    - new Date(latest)) / 86400000)
      : null
  };
  fxCachePut_('fx_exp_all', out, 600);
  return out;
}

/* مرة واحدة: بيقرا كل النسخ القديمة من ملف المصروفات على Drive ويحفظ حركاتها
   في الأرشيف. بيجيب كل اللي لسه ظاهر في أي نسخة — اللي اتقفل ومفيش نسخة
   فيه مش ممكن يتجاب. */
function backfillExpenseArchive() {
  var lock = LockService.getScriptLock();
  try { if (!lock.tryLock(30000)) return { ok: false, error: 'مشغول — جرب كمان شوية' }; }
  catch (e) { return { ok: false, error: 'مشغول' }; }
  try {
    var folder = DriveApp.getFolderById(EXPORT_FOLDER);
    var it = folder.getFilesByName('Expenses_9882-3C97_1.xlsx'), list = [];
    while (it.hasNext()) list.push(it.next());
    list.sort(function (a, b) { return a.getLastUpdated() - b.getLastUpdated(); });

    var read = 0, added = 0, errors = [];
    list.forEach(function (f) {
      try {
        var r = xlsxToRows_(f);
        if (!r.ok) { errors.push(r.error); return; }
        read++;
        added += archiveExpenses_(parseExpenseRows_(r.rows));
      } catch (e2) { errors.push(e2.message); }
    });
    var bk = null;
    try { ensureExpenseBackupTrigger_(); bk = syncExpensesFromBackup_(true); } catch (eb) { bk = { ok: false, error: eb.message }; }
    fxClearCache_('fx_exp_all');
    return { ok: true, versions: list.length, read: read, added: added + ((bk && bk.added) || 0), errors: errors.slice(0, 3), backup: bk };
  } catch (e3) {
    return { ok: false, error: e3.message };
  } finally {
    try { lock.releaseLock(); } catch (e4) {}
  }
}

/* مراجعة المصروفات (صفحة expenses.html): الموظف المسؤول بيعلّم كل حركة "تمام" أو "محتاجة توضيح" بملاحظة */
var EXP_REVIEW_SHEET = 'مراجعة المصروفات';
function getExpReviews() {
  var out = {};
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(EXP_REVIEW_SHEET);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().forEach(function (r) {
      if (r[0]) out[r[0]] = { status: r[1], note: r[2], by: r[3], at: r[4] };
    });
  } catch (e) {}
  return { ok: true, reviews: out };
}
function expReview(d) {
  var id = String(d.id || '').trim();
  if (!id) return { ok: false, error: 'رقم الحركة ناقص' };
  var status = d.status === 'ask' ? 'ask' : (d.status === 'ok' ? 'ok' : '');
  var sh = getOrCreateSheet_(EXP_REVIEW_SHEET, ['الحركة', 'الحالة', 'ملاحظة', 'راجعها', 'الوقت']);
  sh.getRange('A:A').setNumberFormat('@');
  var row = [[id, status, String(d.note || '').slice(0, 300), String(d.by || '').slice(0, 40),
              Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm')]];
  var n = sh.getLastRow(), at = 0;
  if (n > 1) { var ids = sh.getRange(2, 1, n - 1, 1).getDisplayValues(); for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) { at = i + 2; break; } }
  if (at) sh.getRange(at, 1, 1, 5).setValues(row); else sh.getRange(n + 1, 1, 1, 5).setValues(row);
  return { ok: true };
}

function getExpensesData(params) {
  try {
    var all = allExpenses_();
    var R = resolveRange_(params);

    /* 🔧 إصلاح: "ايراد مديونيات" كان بيتجمع في إجمالي المصروفات.
       ده فلوس داخلة مش خارجة — الإجمالي كان منفوخ بقيمتها. */
    var byCat = {}, items = [], total = 0, count = 0, income = 0, incomeCount = 0;
    var ledgerTotal = 0, ledgerCount = 0;   /* اللي اتكمّل من إجمالي النظام اليومي */

    all.items.forEach(function (e) {
      if (e.date < R.from || e.date > R.to) return;

      var row = {
        id: e.id, category: e.category, amount: e.amount,
        date: e.date, time: e.time || '',
        company: e.company || '', staff: e.staff || '',
        name: e.name || '', detail: e.detail || '',
        isIncome: !!e.isIncome, fromLedger: !!e.fromLedger,
        desc: [e.name, e.detail].filter(function (x) { return x; }).join(' — ') || '—'
      };
      items.push(row);
      if (e.fromLedger && !e.isIncome) { ledgerTotal += e.amount; ledgerCount++; }

      if (e.isIncome) { income += e.amount; incomeCount++; return; }

      if (!byCat[e.category]) byCat[e.category] = { total: 0, count: 0 };
      byCat[e.category].total += e.amount;
      byCat[e.category].count++;
      total += e.amount; count++;
    });

    var list = Object.keys(byCat).map(function (k) {
      return { category: k, total: byCat[k].total, count: byCat[k].count };
    }).sort(function (a, b) { return b.total - a.total; });

    return {
      ok: true, label: R.label, total: total, count: count,
      income: income, income_count: incomeCount,
      ledger_total: Math.round(ledgerTotal * 100) / 100, ledger_count: ledgerCount,
      byCategory: list, items: items,
      /* التنبيه: لو آخر مصروف بقاله كتير يبقى التصدير واقف */
      lastEntry: all.latestEntry,
      staleDays: all.staleDays,
      itemizedStaleDays: all.itemizedStaleDays,
      companyPaidRows: all.companyPaidRows,
      stale: (all.staleDays !== null && all.staleDays > 2),
      sourceAt: all.fileAt,
      sourceError: all.fileError
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}