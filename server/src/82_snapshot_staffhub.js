// ==== MODULE 82_snapshot_staffhub (split from server/Code.js; load order = file name order) ====



// ═══════════════════════════════════════════════════════════════════
// 📸 نظام اللقطة (Snapshot) — السبب الحقيقي في السرعة
//
// المشكلة: الداشبورد كان بيحسب كل حاجة وقت ما تفتحه.
//   الديون = قراءة ملفات سنة كاملة من Drive
//   المخزون = مسح شيت STOCK كامل
// والكاش بيخلص كل شوية، فأول واحد يفتح بعده بيدفع التمن كامل.
//
// الحل: تريجر بيشتغل لوحده كل ساعة، بيحسب الحاجات التقيلة دي
// ويحفظ النتيجة في ملفات JSON صغيرة على Drive. الداشبورد بيقرا
// الملف الجاهز بس — فبيفتح في ثانية، دايمًا.
//
// اللي بيفضل لحظي (مش من اللقطة):
//   • مبيعات وربح ودين النهاردة (من Daily_Mini_Statics)
//   • مين موجود دلوقتي (من Connecteam مباشرة)
//   • رسايل العملاء
// ═══════════════════════════════════════════════════════════════════

var SNAPSHOT_SHEET = 'اللقطة';
var SNAP_CHUNK = 45000;   // أقصى حجم للخلية الواحدة في جوجل شيتس ~50 ألف حرف

/* ═══════════════════════════════════════════════════════════════════
   ⚠️ ليه شيت مش Drive؟
   النسخة القديمة كانت بتحفظ اللقطة كملف JSON على Drive عن طريق
   DriveApp.Folder.createFile — ودي محتاجة تصريح الكتابة على Drive
   كامل (auth/drive). التصريح ده مكانش موجود، فالكتابة كانت بترفض
   واللقطة تفضل "لسه متبنيتش" مهما اشتغل التريجر.

   الشيتات السكربت بيكتب فيها أصلاً من غير أي تصريح جديد (شيت
   الموظفين، رسايل SMS، المندوبين...). فحوّلنا اللقطة تتخزن هناك.

   البيانات بتتقسّم على خلايا لأن الخلية الواحدة سقفها ~50 ألف حرف.
   ═══════════════════════════════════════════════════════════════════ */

function snapSheet_() {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sh = ss.getSheetByName(SNAPSHOT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SNAPSHOT_SHEET);
    sh.appendRow(['الاسم', 'وقت البناء', 'عدد الأجزاء', 'البيانات']);
    sh.hideSheet();          // مش محتاج تشوفه، ده تخزين داخلي
  }
  return sh;
}

function snapSave_(name, data) {
  var payload = JSON.stringify({
    builtAt: Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss'),
    data: data
  });

  var parts = [];
  for (var i = 0; i < payload.length; i += SNAP_CHUNK) {
    parts.push(payload.substring(i, i + SNAP_CHUNK));
  }
  /* الصف الواحد بياخد 100 عمود بالكتير = ~4.5 مليون حرف.
     لو عدّينا كده يبقى فيه حاجة غلط في البيانات نفسها. */
  if (parts.length > 100) {
    throw new Error('اللقطة كبيرة أوي: ' + Math.round(payload.length / 1024) + ' ك.ب');
  }

  var sh = snapSheet_();
  var last = sh.getLastRow();
  var row = -1;
  if (last > 1) {
    var names = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var r = 0; r < names.length; r++) {
      if (String(names[r][0]) === name) { row = r + 2; break; }
    }
  }
  if (row === -1) row = last + 1;

  /* بنفضّي الصف القديم الأول — لو اللقطة الجديدة أقصر من القديمة،
     الأجزاء الزيادة كانت هتفضل وتلخبط القراءة. */
  sh.getRange(row, 1, 1, sh.getMaxColumns()).clearContent();

  var out = [name,
             Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss'),
             parts.length].concat(parts);
  sh.getRange(row, 1, 1, out.length).setValues([out]);

  return Math.round(payload.length / 1024);   // الحجم بالكيلوبايت
}

function snapLoad_(name) {
  try {
    var cached = fxCacheGet_('snap_' + name);
    if (cached) return cached;

    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(SNAPSHOT_SHEET);
    if (!sh || sh.getLastRow() <= 1) return null;

    var last = sh.getLastRow();
    var names = sh.getRange(2, 1, last - 1, 1).getValues();
    var row = -1;
    for (var r = 0; r < names.length; r++) {
      if (String(names[r][0]) === name) { row = r + 2; break; }
    }
    if (row === -1) return null;

    var n = parseInt(sh.getRange(row, 3).getValue(), 10);
    if (!n || n < 1) return null;

    var cells = sh.getRange(row, 4, 1, n).getValues()[0];
    var joined = cells.join('');
    if (!joined) return null;

    var parsed = JSON.parse(joined);
    if (!parsed || !parsed.data) return null;

    parsed.data.snapshot_at = parsed.builtAt;
    fxCachePut_('snap_' + name, parsed.data, 900);   // ربع ساعة في الذاكرة كمان
    return parsed.data;
  } catch (e) {
    Logger.log('خطأ snapLoad_ (' + name + '): ' + e.message);
    return null;
  }
}

// ── الدالة اللي التريجر بينده عليها كل ساعة ──
function buildSnapshot() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('⏳ فيه بناء لقطة شغال دلوقتي — سيبناه يكمّل');
    return;
  }

  try {
    var t0 = new Date().getTime();
    var done = [], failed = [];

    /* سجل المصروفات اليومي + أرشفة الملف الحي — كل ساعة مع اللقطة. كل واحدة
       لوحدها عشان فشل واحدة ميوقفش اللقطة. */
    try { recordDailyStats_(); } catch (eS) { Logger.log('خطأ recordDailyStats_: ' + eS.message); }
    try { logShortageSnapshot_(); } catch (eSh) { Logger.log('خطأ سجل النواقص: ' + eSh.message); }
    try {
      var fx = readExpenseFile_();
      if (fx.ok) archiveExpenses_(parseExpenseRows_(fx.rows));
    } catch (eA) { Logger.log('خطأ أرشفة المصروفات: ' + eA.message); }

    /* كل واحدة لوحدها: بنحسب، وبنكتب، وبنسجّل السبب لو وقعت.
       الحساب والكتابة اتنين منفصلين — فشل الكتابة كان بيتخبّى قبل كده. */
    function build(label, key, calc) {
      try {
        var r = calc();
        if (!r || r.ok === false) {
          failed.push(label + ': الحساب رجع ' + ((r && r.error) || 'فاضي'));
          return;
        }
        var kb = snapSave_(key, r);
        done.push(label + ' (' + kb + 'ك.ب)');
      } catch (e) {
        failed.push(label + ': ' + e.message);
      }
    }

    build('الديون',    'debts',     function () { return getDebtsData(); });
    build('المخزون',   'inventory', function () { return getInventoryAging_uncached(); });
    build('المندوبين', 'agents',    function () { return getAgentsData(); });

    // نفضّي الكاش عشان أول فتحة جاية تقرا اللقطة الجديدة
    ['snap_debts', 'snap_inventory', 'snap_agents', 'fx_home_bundle', 'fx_inv_aging', 'fx_debts']
      .forEach(fxClearCache_);

    var secs = Math.round((new Date().getTime() - t0) / 1000);
    var props = PropertiesService.getScriptProperties();
    props.setProperty('lastSnapshotAt',
      Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss') + ' (' + secs + ' ثانية)');
    /* السبب بيتحفظ عشان يظهر في الداشبورد — مش في اللوج بس */
    props.setProperty('lastSnapshotResult',
      (failed.length ? '❌ ' + failed.join(' | ') : '✅ ' + done.join('، ')));

    Logger.log('📸 اللقطة: ' + secs + ' ثانية — نجح: ' + (done.join('، ') || 'ولا حاجة') +
               (failed.length ? ' | فشل: ' + failed.join(' | ') : ''));
    if (failed.length) {
      sendTelegramStaff('⚠️ اللقطة فشلت\n' + SEP + '\n' + failed.join('\n'), PERSONAL_CHAT);
    }
  } finally {
    lock.releaseLock();
  }
}

// ── تشغيل التحديث التلقائي كل ساعة (بيتنادى من زرار في الداشبورد) ──
function setupSnapshotTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildSnapshot') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildSnapshot').timeBased().everyHours(1).create();
  Logger.log('✅ التحديث التلقائي اشتغل — هيبني لقطة جديدة كل ساعة');
  return { ok: true };
}

function snapshotStatus() {
  var props = PropertiesService.getScriptProperties();
  var on = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'buildSnapshot';
  });
  var names = ['debts', 'inventory', 'agents'];
  var files = names.map(function (n) {
    var s = snapLoad_(n);
    return { name: n, ready: !!s, builtAt: s ? (s.snapshot_at || '') : '' };
  });
  return {
    ok: true,
    triggerOn: on,
    lastRun: props.getProperty('lastSnapshotAt') || '',
    lastResult: props.getProperty('lastSnapshotResult') || '',
    files: files
  };
}

// ── نسخ تقرا اللقطة الأول، ولو مش موجودة بتحسب عادي ──
function getDebtsSnap() {
  var s = snapLoad_('debts');
  if (s) return s;
  return fxDebtsCached_();
}

function getInventorySnap() {
  var s = snapLoad_('inventory');
  if (s) return s;
  return getInventoryAging();
}

function getAgentsSnap() {
  var s = snapLoad_('agents');
  if (s) return s;
  return getAgentsData();
}

function getExpiryByMonthSnap() {
  var inv = getInventorySnap();
  if (!inv || !inv.ok) return { ok: false, error: (inv && inv.error) || 'تعذّر تحليل المخزون' };
  return {
    ok: true,
    generated_date: inv.generated_date,
    snapshot_at: inv.snapshot_at || '',
    expired: inv.expiry_by_month.expired,
    months: inv.expiry_by_month.months
  };
}

// ── الحزمة السريعة للصفحة الرئيسية: لحظي + لقطة ──
function getHomeBundleFast() {
  function safe_(label, fn) {
    try { return fn(); }
    catch (err) { return { ok: false, error: label + ': ' + err.message }; }
  }

  return {
    ok: true,
    // لحظي
    daily:       safe_('daily',       function () { return getSystemDailyTotals(); }),
    attendance:  safe_('attendance',  function () {   // Connecteam بره: نحفظه دقيقة بدل ما نسأله مع كل فتحة
      var c = fxCacheGet_('fx_att_live'); if (c) return c;
      var a = getAttendanceLiveV2(); if (a && a.ok) fxCachePut_('fx_att_live', a, 60); return a;
    }),
    maintenance: safe_('maintenance', function () { return getMaintenanceStatus(); }),
    // من اللقطة
    expiry:      safe_('expiry',      function () { return getExpiryByMonthSnap(); }),
    agents:      safe_('agents',      function () { return getAgentsSnap(); }),
    debts:       safe_('debts',       function () { return getDebtsSnap(); }),
    generated:   Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss')
  };
}


// ═══════════════════════════════════════════════════════════════════
// 👥 حزمة الموظفين — نداء واحد بدل تلاتة
//
// المشكلة: صفحة الموظفين كانت بتبعت 3 طلبات (حضور مباشر + سجل + أداء)،
// واتنين منهم بيكلموا Connecteam. وApps Script بينفّذ طلبات نفس المستخدم
// واحد ورا التاني، فالمجموع كان بيوصل لدقيقة.
//
// الحل: قراءة واحدة من Connecteam بتغطي الفترة كلها، و"مين موجود دلوقتي"
// بيتحسب من نفس البيانات (الشيفتات المفتوحة النهاردة) بدل نداء تاني.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// ⚡ كاش عام للنداءات التقيلة اللي مش في اللقطة
// السبب: getMonthTotalsRaw بيقرا شهر كامل من الملفات، وgetProfitLoss
// وgetExpensesData بيقروا شيتات كاملة. من غير كاش، كل فتحة صفحة
// بتعيد الشغل من الأول.
// ═══════════════════════════════════════════════════════════════════
/* 🆕 مدة الكاش بتتحدد حسب الفترة نفسها.
   المشكلة اللي كانت: كل الفترات كانت بكاش 10 دقايق — يعني "اليوم"
   (بيتغير مع كل فاتورة) بياخد نفس معاملة "الشهر اللي فات"
   (بيانات مقفولة مش هتتغير). فلو بعت فاتورة دلوقتي كنت تستنى
   10 دقايق زيادة على تأخير نظام البيع نفسه. */
function cacheTTL_(params) {
  var r = (params && params.range) || 'month';
  if (params && params.from && params.to) return 1800;  // فترة مخصصة = تاريخ ثابت
  if (r === 'today')      return 45;      // أقل حاجة — البيانات حية
  if (r === 'yesterday')  return 900;     // خلصت، بس ممكن مرتجع متأخر
  if (r === 'week')       return 300;
  if (r === 'month')      return 300;     // فيه النهاردة جواه
  if (r === 'lastMonth')  return 3600;    // مقفول خلاص
  return 600;
}

function cachedCall_(name, params, fn, seconds) {
  var key = 'fx_c_' + name + '_' + JSON.stringify(params || {});
  var hit = fxCacheGet_(key);
  if (hit) { hit.cached = true; return hit; }
  var out = fn();
  if (out && out.ok !== false) fxCachePut_(key, out, seconds || 300);
  return out;
}

function getStaffHub(params) {
  try {
    params = params || {};
    var tz = 'Africa/Cairo';
    var now = new Date();
    var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

    // مفتاح كاش حسب الفترة المطلوبة
    var ck = 'fx_hub_' + (params.from ? (params.from + '_' + params.to) : (params.range || 'month'));
    var cached = fxCacheGet_(ck);
    if (cached) { cached.cached = true; return cached; }

    // (١) الأداء من شيت الموظفين
    var kpi = {};
    try { kpi = getStaffKPIData(params); } catch (e) { kpi = { employees: [], error: e.message }; }

    // (٢) الفترة المطلوبة للحضور — نفس التفسير بالظبط
    var R = resolveRange_(params);
    var from = R.from, to = R.to, label = R.label;

    // لو الفترة مش شاملة النهاردة، بنمدّها عشان نعرف مين موجود دلوقتي
    var ctTo = (to < today) ? today : to;

    // (٣) قراءة واحدة من Connecteam
    var rows = [], live = [], ctError = null;
    var r = ctGetShifts_(from, ctTo);
    if (!r.ok) {
      ctError = r.error;
    } else {
      var map = ctUserMap_();
      var nowSec = Math.floor(Date.now() / 1000);

      r.shifts.forEach(function (entry) {
        var nm = ctName_(entry.userId, map);
        ctShiftsOf_(entry).forEach(function (sh) {
          var a = ctTs_(sh.start);
          if (!a) return;
          var b = ctTs_(sh.end);
          var startD = new Date(a * 1000);
          var dateStr = Utilities.formatDate(startD, tz, 'yyyy-MM-dd');

          // شيفت مفتوح النهاردة = الراجل موجود دلوقتي
          if (!b && dateStr === today) {
            live.push({ name: nm, checkInTimestamp: a,
                        elapsedMinutes: Math.round((nowSec - a) / 60) });
          }

          // السجل: بس الأيام اللي جوه الفترة المطلوبة
          if (dateStr < from || dateStr > to) return;
          var endD = b ? new Date(b * 1000) : null;
          rows.push({
            date: dateStr,
            name: nm,
            checkIn: Utilities.formatDate(startD, tz, 'hh:mm a'),
            checkOut: endD ? Utilities.formatDate(endD, tz, 'hh:mm a') : 'مفتوح',
            durationMin: endD ? Math.round((b - a) / 60) : null
          });
        });
      });
      rows.sort(function (x, y) { return x.date.localeCompare(y.date) || x.name.localeCompare(y.name); });
    }

    var out = {
      ok: true,
      label: label, from: from, to: to,
      employees: kpi.employees || [],
      daily: kpi.daily || [],
      targets: kpi.targets || TARGETS,
      live: live,
      liveCount: live.length,
      rows: rows,
      attendanceError: ctError
    };

    fxCachePut_(ck, out, 120);   // دقيقتين
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}