// ==== MODULE 61_finance (split from server/Code.js; load order = file name order) ====


/* 🔁 طلبات Drive أحيانًا بترجع "خطأ في الخدمة" — نستنى ونعيد بدل ما الحساب كله يقع */
function driveRetry_(fn) {
  for (var i = 0; i < 3; i++) {
    try { return fn(); }
    catch (e) { if (i === 2) throw e; Utilities.sleep(1500 * (i + 1)); }
  }
}

function getDebtsData() {
  try {
    var folder = DriveApp.getFolderById(SALES_FOLDER);
    var tz = 'Africa/Cairo';
    var today = new Date();
    var daysBack = 365;

    /* ═══════════════════════════════════════════════════════════════
       ⚠️ ليه الطريقة دي بالذات؟
       جربنا على البيانات الحقيقية ولقينا إن جمع الديون يوم بيوم
       مستحيل يظبط، لأن فيه أحداث بتغيّر رصيد العميل ومش بتتسجل في
       ملف الديون أصلاً (مرتجعات / تعديلات يدوية على الفواتير).
       مثال حقيقي — طارق بلتاجى 1 أغسطس:
           238.84 + 367 = 605.84  ✓
           605.84 + 522 = 1127.84  ← بس النظام كتب 866.85
           فرق 260.99 حصل من غير أي سطر.

       الحل: كل سطر في الملف بيحمل previousbalance — ده رصيد العميل
       من وجهة نظر النظام نفسه. فلو أخدنا آخر حدث بس لكل عميل:
           رصيده = previousbalance + debit
       الرقم ده بيبلع تلقائيًا أي حاجة فاتت قبله. الطريقة بتصحح نفسها.
       ═══════════════════════════════════════════════════════════════ */

    var latest = {};   // رقم كانوني -> آخر حالة معروفة للعميل

    function remember(phoneRaw, name, balance, when) {
      var canon = canonicalEgyptPhone_(phoneRaw);
      if (!canon) canon = String(phoneRaw || '').trim();   // معرّف داخلي زي "200"
      if (!canon) return;
      var cur = latest[canon];
      if (cur && cur.when > when) return;                  // عندنا أحدث منه
      latest[canon] = {
        phone: canon,
        name: (name && String(name).trim()) ? String(name).trim() : (cur ? cur.name : 'عميل'),
        balance: balance,
        when: when
      };
    }

    var totalNewDebt = 0, totalCollected = 0;

    /* ⚡ قايمة ملفات الديون كلها في طلب واحد بدل 365 طلب (Drive كان بيرفض من كترهم) */
    var idx = {};
    driveRetry_(function () {
      idx = {};
      var it = folder.searchFiles("title contains 'debits' and trashed = false");
      while (it.hasNext()) { var f = it.next(), n = f.getName(); if (!idx[n]) idx[n] = f; }
    });
    /* ملفات الأيام القديمة مش بتتغير — بنحفظها في الكاش 6 ساعات عشان منقراش 365 ملف كل ساعة */
    var cache = CacheService.getScriptCache();
    var recent = Utilities.formatDate(new Date(today.getTime() - 2 * 86400000), tz, 'yyyy-MM-dd');

    for (var i = daysBack - 1; i >= 0; i--) {
      var d = new Date(today.getTime() - i * 86400000);
      var dateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      var fname = 'debits' + dateStr + '.txt', file = idx[fname];
      if (!file) continue;
      var ck = 'dbt_' + dateStr, content = dateStr < recent ? cache.get(ck) : null;
      if (content === null) {
        content = driveRetry_(function () { return file.getBlob().getDataAsString('UTF-8'); });
        if (dateStr < recent && content && content.length < 90000) { try { cache.put(ck, content, 21600); } catch (eC) {} }
      }
      if (!content) continue;

      var events = [];   // بنجمع كل الأحداث بترتيب ظهورها في الملف

      /* (أ) سطور الدين — بتدينا previousbalance + debit */
      var rx = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
      while ((m = rx.exec(content)) !== null) {
        var tuples = extractTuples('(' + m[1] + ')');
        for (var t = 0; t < tuples.length; t++) {
          try {
            var v = parseValues(tuples[t]);
            if (!v || v.length < 16) continue;
            var name  = v[3] ? v[3].trim() : '';
            var phone = v[4] ? v[4].trim() : '';
            if (!phone) continue;
            var when  = (v[5] && String(v[5]).trim()) ? String(v[5]).trim() : (dateStr + ' 00:00:00');
            var debit = parseFloat(v[8]) || 0;
            var prev  = parseFloat(v[15]) || 0;
            totalNewDebt += debit;
            events.push({ pos: m.index + t, phone: phone, name: name,
                          balance: prev + debit, when: when });
          } catch (e) { continue; }
        }
      }

      /* (ب) سطور السداد — "إجمالى الديون بعد" هو الرصيد النهائي
         🔧 شلنا شرط الـ5 خانات: فيه عملاء رقمهم معرّف داخلي قصير
            زي "الحاجة رزقة محمد (200)" و"ام علي صاحب المكان (178)".
            الشرط القديم كان بيتجاهل سدادهم فدينهم ميتصفرش أبدًا. */
      var cpRx = /([^\n(]{2,40})\s*\(([0-9+]{2,})\)\s*[\r\n]+\s*إجمالى الديون قبل\s*([\d.]+)\s*[\r\n]+\s*إجمالى الديون بعد\s*([\d.]+)/g;
      var cp;
      while ((cp = cpRx.exec(content)) !== null) {
        var before = parseFloat(cp[3]) || 0;
        var after  = parseFloat(cp[4]) || 0;
        if (before > after) totalCollected += (before - after);
        events.push({ pos: cp.index, phone: cp[2].trim(), name: cp[1].trim(),
                      balance: after, when: dateStr + ' 23:59:59' });
      }

      /* بنطبّقهم بترتيب ظهورهم في الملف — الأخير هو الصح */
      events.sort(function (a, b) { return a.pos - b.pos; });
      events.forEach(function (ev) { remember(ev.phone, ev.name, ev.balance, ev.when); });
    }

    /* ---- بناء القايمة ---- */
    var list = [], totalNet = 0;
    Object.keys(latest).forEach(function (k) {
      var c = latest[k];
      if (c.balance <= 0.5) return;              // مسدّد (بنتسامح مع كسور القرش)
      var daysSince = Math.floor((today - new Date(c.when.replace(' ', 'T'))) / 86400000);
      list.push({
        name: c.name, phone: c.phone,
        net: Math.round(c.balance * 100) / 100,
        lastActivity: c.when,
        daysSincePaid: isNaN(daysSince) ? null : daysSince,
        status: 'دين غير مسدد'
      });
      totalNet += c.balance;
    });
    list.sort(function (a, b) { return b.net - a.net; });

    /* ---- 🎯 الرقم الرسمي من نظام البيع ---- */
    var official = null, gap = null, gapPct = null;
    try {
      var sys = getSystemDailyTotals();
      if (sys && sys.ok && sys.total_debt) {
        official = Math.round(sys.total_debt);
        gap = Math.round(totalNet) - official;
        gapPct = official ? Math.abs(gap / official * 100) : null;
      }
    } catch (e) {}

    return {
      ok: true,
      debtors: list,
      count: list.length,

      /* الرقم اللي المفروض يتعرض في الكارت الكبير — رسمي ولحظي */
      total_official: official,
      /* مجموع التفاصيل اللي قدرنا نوصلها من الملفات */
      total_detail: Math.round(totalNet),
      /* الفرق بينهم — لو كبير يبقى فيه عملاء آخر حركة ليهم أقدم من سنة */
      reconcile_gap: gap,
      reconcile_pct: gapPct === null ? null : Math.round(gapPct * 10) / 10,
      reconcile_ok: (gapPct === null) ? null : (gapPct <= 5),

      /* حركة السنة (للعرض بس — مش رصيد) */
      period_new_debt: Math.round(totalNewDebt),
      period_collected: Math.round(totalCollected),

      /* أسماء قديمة عشان أي كود تاني يفضل شغال */
      total_net: official !== null ? official : Math.round(totalNet),
      total_owed: Math.round(totalNewDebt),
      total_paid: Math.round(totalCollected),

      source_updated: 'الإجمالي من نظام البيع · التفاصيل من ملفات آخر ' + daysBack + ' يوم'
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


function getNewCustomersDetail(params) {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName('سجل العملاء الجدد');
  if (!sheet || sheet.getLastRow() <= 1) return { customers: [] };

  var R = resolveRange_(params);
  var cutoff = R.from, end = R.to;

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  var out = [];
  data.forEach(function(r) {
    var rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(r[0]).substring(0,10);
    if (rDate < cutoff || rDate > end) return;
    var empName = resolveEmpName(r[1]);
    if (params.employee && empName !== params.employee) return;
    out.push({ date: rDate, employee: empName, name: r[2], phone: String(r[3]) });
  });
  out.sort(function(a,b){ return b.date.localeCompare(a.date); });
  return { customers: out };
}

function getProfitLossData(params) {
  try {
    const now = new Date();
    const monthKey = params.month || Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM');
    const cutoff = monthKey + '-01';
    const y = parseInt(monthKey.split('-')[0]), m = parseInt(monthKey.split('-')[1]);
    const lastDayOfMonth = new Date(y, m, 0).getDate();
    let end = monthKey + '-' + String(lastDayOfMonth).padStart(2, '0');
    const today = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
    if (end > today) end = today;

    const dailySales = {}, dailyProfit = {};
    const staffSheet = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName('الموظفين');
    if (staffSheet && staffSheet.getLastRow() > 1) {
      const sdata = staffSheet.getRange(2, 1, staffSheet.getLastRow()-1, 15).getValues();
      const bestRow = {};
      sdata.forEach(function(r) {
        if (!r[1] || !r[2]) return;
        const rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(r[0]).substring(0, 10);
        if (rDate < cutoff || rDate > end) return;
        const dk = rDate + '_' + normalizeEmpId(r[1]);
        if (!bestRow[dk] || (parseInt(r[2])||0) > (parseInt(bestRow[dk][2])||0)) bestRow[dk] = r;
      });
      Object.keys(bestRow).forEach(function(dk) {
        const r = bestRow[dk];
        const rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(r[0]).substring(0, 10);
        dailySales[rDate] = (dailySales[rDate] || 0) + (parseInt(r[3]) || 0);
        dailyProfit[rDate] = (dailyProfit[rDate] || 0) + (parseInt(r[14]) || 0);
      });
    }

    /* المصروفات من نفس المصدر الموحّد (ملف Drive + الأرشيف).
       قبل كده كانت بتقرا Monthly_Expenses لوحده — وده فيه يناير بس. */
    const dailyExpenses = {};
    let expStale = null, expLast = '';
    try {
      const all = allExpenses_();
      expStale = all.staleDays;
      expLast = all.latestEntry;
      all.items.forEach(function (e) {
        if (e.date < cutoff || e.date > end) return;
        /* المشتريات مش مصروف تشغيلي — دي بضاعة بتتحول لمخزون */
        if (String(e.category).indexOf('مشتروات') !== -1) return;
        if (String(e.category).indexOf('ايراد') === 0) return;   /* إيراد مش مصروف */
        dailyExpenses[e.date] = (dailyExpenses[e.date] || 0) + e.amount;
      });
    } catch(e) {}

    const props = PropertiesService.getScriptProperties();
    const monthlySalaries = parseFloat(props.getProperty('monthlySalaries_' + monthKey) || '0');
    const dailySalary = monthlySalaries / lastDayOfMonth;

    const allDates = {};
    Object.keys(dailySales).forEach(function(d){ allDates[d] = 1; });
    Object.keys(dailyExpenses).forEach(function(d){ allDates[d] = 1; });

    const days = Object.keys(allDates).sort().map(function(d) {
      const sales = dailySales[d] || 0, profit = dailyProfit[d] || 0, exp = dailyExpenses[d] || 0;
      const net = Math.round(profit - exp - dailySalary);
      return { date: d, sales: sales, profit: profit, expenses: Math.round(exp), salary_share: Math.round(dailySalary), net: net };
    });

    let totalSales = 0, totalProfit = 0, totalExpenses = 0;
    days.forEach(function(d) { totalSales += d.sales; totalProfit += d.profit; totalExpenses += d.expenses; });
    const totalSalariesSoFar = Math.round(dailySalary * days.length);
    const netProfit = Math.round(totalProfit - totalExpenses - totalSalariesSoFar);

    return {
      ok: true, month: monthKey,
      /* تنبيه لو المصروفات باتت — الصافي بيبقى منفوخ من غيرها */
      exp_last_entry: expLast,
      exp_stale_days: expStale,
      exp_stale: (expStale !== null && expStale > 2),
      total_sales: totalSales, total_profit: totalProfit, total_expenses: totalExpenses,
      monthly_salaries: monthlySalaries, daily_salary: Math.round(dailySalary),
      total_salaries_so_far: totalSalariesSoFar,
      net_profit: netProfit,
      days: days
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function setMonthlySalaries(month, amount) {
  PropertiesService.getScriptProperties().setProperty('monthlySalaries_' + month, String(parseFloat(amount) || 0));
}

const NETWORTH_STARTING_DATE = '2026-07-01';
const NETWORTH_STARTING_CASH = 4490;
const NETWORTH_STARTING_INVENTORY = 258887.70;

function getNetWorthData() {
  try {
    const startingTotal = NETWORTH_STARTING_CASH + NETWORTH_STARTING_INVENTORY;
    const now = new Date();
    const today = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');

    let totalProfit = 0;
    const staffSheet = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName('الموظفين');
    if (staffSheet && staffSheet.getLastRow() > 1) {
      const sdata = staffSheet.getRange(2, 1, staffSheet.getLastRow()-1, 15).getValues();
      const bestRow = {};
      sdata.forEach(function(r) {
        if (!r[1] || !r[2]) return;
        const rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(r[0]).substring(0, 10);
        if (rDate < NETWORTH_STARTING_DATE || rDate > today) return;
        const dk = rDate + '_' + normalizeEmpId(r[1]);
        if (!bestRow[dk] || (parseInt(r[2])||0) > (parseInt(bestRow[dk][2])||0)) bestRow[dk] = r;
      });
      Object.keys(bestRow).forEach(function(dk) {
        totalProfit += (parseInt(bestRow[dk][14]) || 0);
      });
    }

    let totalRealExpenses = 0, totalPurchases = 0;
    try {
      allExpenses_().items.forEach(function (e) {
        if (e.date < NETWORTH_STARTING_DATE || e.date > today) return;
        if (String(e.category).indexOf('ايراد') === 0) return;
        if (String(e.category).indexOf('مشتروات') !== -1) totalPurchases += e.amount;
        else totalRealExpenses += e.amount;
      });
    } catch(e) {}

    const props = PropertiesService.getScriptProperties();
    let totalSalaries = 0;
    let cursor = new Date(NETWORTH_STARTING_DATE + 'T00:00:00');
    const endD = new Date(today + 'T00:00:00');
    while (cursor <= endD) {
      const mKey = Utilities.formatDate(cursor, 'Africa/Cairo', 'yyyy-MM');
      const monthlySalaries = parseFloat(props.getProperty('monthlySalaries_' + mKey) || '0');
      const lastDay = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0).getDate();
      const dailySalary = monthlySalaries / lastDay;
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth(), lastDay);
      const rangeStart = monthStart < new Date(NETWORTH_STARTING_DATE + 'T00:00:00') ? new Date(NETWORTH_STARTING_DATE + 'T00:00:00') : monthStart;
      const rangeEnd = monthEnd > endD ? endD : monthEnd;
      const daysInRange = Math.floor((rangeEnd - rangeStart) / 86400000) + 1;
      totalSalaries += dailySalary * Math.max(0, daysInRange);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1);
    }
    totalSalaries = Math.round(totalSalaries);

    let currentInventoryActual = 0;
    try {
      const dss = SpreadsheetApp.openById(DAILY_STATS_SHEET_ID);
      const dsheet = dss.getSheets()[0];
      const ddata = dsheet.getDataRange().getValues();
      const map = {};
      ddata.forEach(function(r){ if (r[0]) map[String(r[0]).trim()] = r[1]; });
      currentInventoryActual = parseFloat(map['اجمالى المخزون تكلفة']) || 0;
    } catch(e) {}

    const estimatedTotal = Math.round(startingTotal + totalProfit - totalRealExpenses - totalSalaries);

    return {
      ok: true,
      starting_date: NETWORTH_STARTING_DATE,
      starting_cash: NETWORTH_STARTING_CASH,
      starting_inventory: NETWORTH_STARTING_INVENTORY,
      starting_total: Math.round(startingTotal),
      total_profit_since_start: totalProfit,
      total_real_expenses_since_start: Math.round(totalRealExpenses),
      total_purchases_since_start: Math.round(totalPurchases),
      total_salaries_since_start: totalSalaries,
      current_inventory_actual: currentInventoryActual,
      estimated_total_now: estimatedTotal,
      change_since_start: estimatedTotal - Math.round(startingTotal)
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

/* فحص النسخة الاحتياطية: بيفك آخر pharmaclick_backup ويدوّر على جدول المصروفات.
   الهدف نعرف شكل الجدول عشان نقرا المصروفات منه بدل التصدير اليومي اللي واقف. */
/* فحص النسخة الاحتياطية — بيقرأ النسخة الكاملة (مش _temp) ويعدّ المصروفات شهر بشهر،
   ويبص على جداول الخزنة والتقفيل عشان نعرف المصروفات متسجلة فين بالظبط. */
function sqlTuples_(block) {
  var out = [], depth = 0, cur = '', q = false;
  for (var i = 0; i < block.length; i++) {
    var c = block[i];
    if (q) {
      cur += c;
      if (c === '\\') { cur += block[++i] || ''; continue; }
      if (c === "'") { if (block[i + 1] === "'") { cur += block[++i]; continue; } q = false; }
      continue;
    }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === '(') { depth++; if (depth === 1) { cur = ''; continue; } }
    if (c === ')') { depth--; if (depth === 0) { out.push(cur); continue; } }
    if (depth >= 1) cur += c;
  }
  return out;
}
function sqlVals_(t) {
  var vals = [], cur = '', q = false, wasQ = false;
  for (var i = 0; i < t.length; i++) {
    var c = t[i];
    if (q) {
      if (c === '\\') { cur += t[++i] || ''; continue; }
      if (c === "'") { if (t[i + 1] === "'") { cur += "'"; i++; continue; } q = false; continue; }
      cur += c; continue;
    }
    if (c === "'") { q = true; wasQ = true; continue; }
    if (c === ',') { vals.push(wasQ ? cur : (cur.trim() === 'NULL' ? null : cur.trim())); cur = ''; wasQ = false; continue; }
    cur += c;
  }
  vals.push(wasQ ? cur : (cur.trim() === 'NULL' ? null : cur.trim()));
  return vals;
}
function sqlTableRows_(txt, table) {
  var rx = new RegExp('(?:INSERT|REPLACE)(?:\\s+IGNORE)?\\s+INTO\\s+[`"]?' + table + '[`"]?\\s*(?:\\([^)]*\\)\\s*)?VALUES', 'gi'), m, rows = [], stmts = 0;
  while ((m = rx.exec(txt))) {
    stmts++;
    var start = m.index + m[0].length, end = txt.indexOf(');\n', start);
    if (end === -1) end = txt.indexOf(');', start);
    if (end === -1) break;
    sqlTuples_(txt.substring(start, end + 1)).forEach(function (t) { rows.push(t); });
    rx.lastIndex = end;
  }
  return { stmts: stmts, rows: rows };
}
function sqlColumns_(txt, table) {
  var ct = new RegExp('CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?[`"]?' + table + '[`"]?\\s*\\(([\\s\\S]*?)\\)\\s*(?:ENGINE|;)', 'i').exec(txt);
  return ct ? (ct[1].match(/^\s*[`"](\w+)[`"]/gm) || []).map(function (c) { return c.replace(/[\s`"]/g, ''); }) : [];
}
function backupProbe() {
  try {
    var it = DriveApp.searchFiles("title contains 'pharmaclick_backup_9882' and trashed = false"), full = null, temp = null;
    while (it.hasNext()) {
      var f = it.next(), isTemp = /_temp\.zip$/i.test(f.getName());
      if (isTemp) { if (!temp || f.getLastUpdated() > temp.getLastUpdated()) temp = f; }
      else if (!full || f.getLastUpdated() > full.getLastUpdated()) full = f;
    }
    var pick = full || temp;
    if (!pick) return { ok: false, error: 'مفيش نسخة احتياطية' };
    var blob = pick.getBlob(); blob.setContentType('application/zip');
    var entries = Utilities.unzip(blob), out = { ok: true, file: pick.getName(), fileDate: pick.getLastUpdated(), tables: {} };
    var watch = ['expenses', 'expensecategories', 'safebankmovements', 'cashwaydetails', 'cashway', 'dailyclose', 'shiftclose', 'printset', 'doselabelstyles'];   /* آخر اتنين: مقاس ملصقات Pharmaclick */
    entries.forEach(function (e) {
      if (!/\.sql$/i.test(e.getName())) return;
      var txt = e.getDataAsString('UTF-8');
      out.sqlSize = txt.length;
      var cnt = 0, p = -1; while ((p = txt.indexOf('INSERT', p + 1)) !== -1) cnt++;
      out.insertWordsInFile = cnt;
      var fe = txt.search(/INTO\s+[`"]?expenses[`"]?\s/i);
      out.firstExpensesInsert = fe === -1 ? null : txt.substr(Math.max(0, fe - 30), 400);
      watch.forEach(function (t) {
        var cols = sqlColumns_(txt, t), r = sqlTableRows_(txt, t), info = { columns: cols.length, statements: r.stmts, rows: r.rows.length };
        var iTime = cols.indexOf('time'), iVal = cols.indexOf('value'), iDel = cols.indexOf('deleted');
        var parsed = r.rows.map(function (x) { try { return sqlVals_(x); } catch (z) { return null; } }).filter(Boolean);
        if (iTime === -1) iTime = cols.indexOf('date');
        if (iTime !== -1) {
          var months = {};
          parsed.forEach(function (v) {
            var mk = String(v[iTime] || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(mk)) return;
            var o = months[mk] = months[mk] || { n: 0, sum: 0, deleted: 0 };
            o.n++; if (iVal !== -1) o.sum = Math.round((o.sum + (parseFloat(v[iVal]) || 0)) * 100) / 100;
            if (iDel !== -1 && String(v[iDel]) === '1') o.deleted++;
          });
          var ks = Object.keys(months).sort().slice(-4), mm = {};
          ks.forEach(function (k) { mm[k] = months[k]; });
          info.lastMonths = mm;
        }
        info.last = parsed.slice(-3).map(function (v) {
          var o = {}; cols.forEach(function (c, i) { if (v[i] !== null && v[i] !== '' && v[i] !== '0') o[c] = String(v[i]).slice(0, 60); }); return o;
        });
        out.tables[t] = info;
      });
    });
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* تنظيف النسخ الاحتياطية لـ Pharmaclick:
   آخر 7 أيام: الكل · لحد 60 يوم: نسخة لكل يوم · الأقدم: نسخة لكل شهر.
   apply=false → حساب بس. apply=true → نقل لسلة المهملات (بيرجع خلال 30 يوم). */
/* قايمة ملفات من Drive API مباشرة: طلب واحد لكل 1000 ملف. (DriveApp كان بيسأل عن اسم/حجم/تاريخ كل ملف لوحده، فالـ25 ثانية كانت بتخلص في القراية
   وبينقل 6 ملفات بس في المرة.) */
function driveListFiles_(q, fields) {
  var tok = ScriptApp.getOAuthToken(), out = [], page = '';
  do {
    var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
      '&fields=' + encodeURIComponent('nextPageToken,files(' + fields + ')') + '&q=' + encodeURIComponent(q) +
      (page ? '&pageToken=' + encodeURIComponent(page) : ''), { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Drive list ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
    var d = JSON.parse(r.getContentText());
    (d.files || []).forEach(function (x) { out.push(x); });
    page = d.nextPageToken || '';
  } while (page);
  return out;
}
/* طلبات Drive API متوازية (30 في المرة). اللي بيفشل (rate limit مثلًا) بيفضل "فاضل" وبيتعاد في التشغيلة الجاية */
function driveBatch_(ids, t0, budgetMs, make) {
  var tok = ScriptApp.getOAuthToken(), done = 0, okIds = [];
  for (var i = 0; i < ids.length; i += 30) {
    if (Date.now() - t0 > budgetMs) break;
    var chunk = ids.slice(i, i + 30), slow = false;
    var rs = UrlFetchApp.fetchAll(chunk.map(function (id) {
      var q = make(id); q.headers = { Authorization: 'Bearer ' + tok }; q.muteHttpExceptions = true; return q;
    }));
    rs.forEach(function (r, k) {
      var c = r.getResponseCode();
      if (c === 200 || c === 204) { done++; okIds.push(chunk[k]); }
      else if (c === 403 || c === 429) slow = true;
    });
    Utilities.sleep(slow ? 2000 : 250);
  }
  return { done: done, ids: okIds };
}
function cleanBackups(apply, budgetMs) {
  var t0 = Date.now(), tz = 'Africa/Cairo';
  var raw = driveListFiles_("name contains 'pharmaclick_backup_' and trashed = false", 'id,name,createdTime,size');
  var files = [];
  raw.forEach(function (f) {
    var n = f.name || '';
    var m = n.match(/_(\d{2})-(\d{2})-(\d{4})(?:_(\d{2})-(\d{2}))?(_temp)?\.zip$/);
    if (!m) return;
    files.push({ id: f.id, name: n, day: m[3] + '-' + m[2] + '-' + m[1], temp: !!m[6],
                 at: Date.parse(f.createdTime) || 0, size: parseInt(f.size, 10) || 0 });
  });
  var today = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00');
  /* الأحدث الأول — أول واحد في كل مجموعة هو اللي بيتساب */
  files.sort(function (a, b) {
    if (a.temp !== b.temp) return a.temp ? 1 : -1;   /* النسخة اليومية الكاملة أولى من temp */
    return b.at - a.at;
  });
  var keepKey = {}, keep = [], del = [];
  files.forEach(function (x) {
    var age = Math.floor((today - new Date(x.day + 'T00:00:00')) / 86400000);
    var key = age <= 7 ? ('N|' + x.name) : (age <= 60 ? ('D|' + x.day) : ('M|' + x.day.slice(0, 7)));
    if (keepKey[key]) del.push(x); else { keepKey[key] = 1; keep.push(x); }
  });
  var mb = function (arr) { return Math.round(arr.reduce(function (s, x) { return s + x.size; }, 0) / 1048576); };
  var out = { ok: true, total: files.length, keep: keep.length, remove: del.length,
              keepMB: mb(keep), freeMB: mb(del), trashed: 0, remaining: 0 };
  if (apply) {
    var r = driveBatch_(del.map(function (x) { return x.id; }), t0, budgetMs || 25000, function (id) {
      return { url: 'https://www.googleapis.com/drive/v3/files/' + id + '?supportsAllDrives=true', method: 'patch',
               contentType: 'application/json', payload: '{"trashed":true}' };
    });
    out.trashed = r.done;
    out.remaining = del.length - r.done;
  }
  return out;
}
function cleanBackupsDaily() { return cleanBackups(true, 240000); }
/* مسح نهائي للنسخ الاحتياطية (zip) اللي في سلة المهملات بس — مش بيلمس أي حاجة تانية في السلة */
function purgeTrashedBackups() {
  var t0 = Date.now();
  var raw = driveListFiles_("name contains 'pharmaclick_backup_' and trashed = true", 'id,name,size').filter(function (f) { return /\.zip$/i.test(f.name || ''); });
  var size = {}; raw.forEach(function (f) { size[f.id] = parseInt(f.size, 10) || 0; });
  var r = driveBatch_(raw.map(function (f) { return f.id; }), t0, 25000, function (id) {
    return { url: 'https://www.googleapis.com/drive/v3/files/' + id + '?supportsAllDrives=true', method: 'delete' };
  });
  var freed = 0; r.ids.forEach(function (id) { freed += size[id] || 0; });
  return { ok: true, deleted: r.done, remaining: raw.length - r.done, freedMB: Math.round(freed / 1048576) };
}
function cleanBackupsAuto() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cleanBackupsDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cleanBackupsDaily').timeBased().everyDays(1).atHour(5).create();
  return { ok: true };
}

function jsonResponseStaff(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}