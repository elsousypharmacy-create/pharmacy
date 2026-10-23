// ==== MODULE 80_cache_home (split from server/Code.js; load order = file name order) ====


// ═══════════════════════════════════════════════════════════════════
// ⚡ قسم السرعة والإصلاحات — أغسطس 2026
//
// ١) كاش مقسّم: الكاش القديم كان بيتخزن بس لو الحجم أقل من 95KB،
//    وسجل الرسايل عدّى الرقم ده من شهور، يعني الكاش كان واقف
//    والسيرفر بيقرا 3 شيتات كاملة في كل فتحة.
// ٢) نداء واحد للصفحة الرئيسية بدل 6 (Apps Script بينفّذ طلبات
//    نفس المستخدم واحد ورا التاني، فالستة كانوا بيقفوا في طابور).
// ٣) سجل الرسايل بقى آخر 30 يوم بس بدل من أول يوم.
// ٤) Connecteam: الرد بيجي ملفوف جوه { data: {...} } والكود القديم
//    مكانش بيفكّه، فكان بيرجّع قايمة فاضية دايمًا من غير رسالة خطأ.
// ═══════════════════════════════════════════════════════════════════

// ── كاش مقسّم: بيشتغل مهما كبرت البيانات ──
function fxCacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key + '_meta');
    if (!meta) return null;
    var count = parseInt(meta, 10);
    var wanted = [];
    for (var i = 0; i < count; i++) wanted.push(key + '_' + i);
    var parts = cache.getAll(wanted);
    var joined = '';
    for (var j = 0; j < count; j++) {
      if (parts[key + '_' + j] === undefined) return null; // جزء ضايع → نحسبها من الأول
      joined += parts[key + '_' + j];
    }
    return joined ? JSON.parse(joined) : null;
  } catch (err) {
    return null;
  }
}

function fxCachePut_(key, value, seconds) {
  try {
    var json = JSON.stringify(value);
    var CHUNK = 90000;
    var count = Math.ceil(json.length / CHUNK);
    if (count > 40) return; // كبير أوي — منخزنش
    var obj = {};
    for (var i = 0; i < count; i++) obj[key + '_' + i] = json.substring(i * CHUNK, (i + 1) * CHUNK);
    var cache = CacheService.getScriptCache();
    cache.putAll(obj, seconds);
    cache.put(key + '_meta', String(count), seconds);
  } catch (err) { /* الكاش مش ضروري */ }
}

function fxClearCache_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key + '_meta');
    if (!meta) return;
    var keys = [key + '_meta'];
    for (var i = 0; i < parseInt(meta, 10); i++) keys.push(key + '_' + i);
    cache.removeAll(keys);
  } catch (err) {}
}

// شغّلها لو عايز تجبر تحديث فوري بعد ما تغيّر حاجة في الشيتات
/* 🆕 بيتنادى من زرار "حدّث دلوقتي" في الداشبورد.
   بيفضّي كاش الأرقام الحية بس — مش بيلمس اللقطة (المخزون/المندوبين)
   عشان الصفحة تفضل سريعة. */
function refreshLiveNumbers() {
  ['fx_home_bundle', 'fx_sms_30'].forEach(fxClearCache_);
  ['today', 'yesterday', 'week', 'month'].forEach(function (r) {
    ['kpi', 'mtr', 'exp'].forEach(function (n) {
      fxClearCache_('fx_c_' + n + '_' + JSON.stringify({ action: 'x', range: r }));
      fxClearCache_('fx_c_' + n + '_' + JSON.stringify({ range: r }));
    });
    fxClearCache_('fx_hub_' + r);
  });
  return { ok: true, at: Utilities.formatDate(new Date(), 'Africa/Cairo', 'HH:mm:ss') };
}

function clearAllFixesCache() {
  ['fx_sms_30', 'fx_home_bundle', 'fx_debts', 'fx_inv_aging', 'ct_users'].forEach(fxClearCache_);
  Logger.log('✅ اتمسح الكاش — أول فتحة جاية هتقرا من الشيتات من جديد');
}


// ═══════════════════════════════════════════════════════════════════
// ١) سجل الرسايل — آخر 30 يوم بس، وبيقرا من آخر الشيت للأول
// ═══════════════════════════════════════════════════════════════════
function getSMSLogFast(params) {
  var days = parseInt((params && params.days) || '30', 10);
  if (isNaN(days) || days < 1) days = 30;
  if (days > 365) days = 365;

  var cacheKey = 'fx_sms_' + days;
  var cached = fxCacheGet_(cacheKey);
  if (cached) { cached.cached = true; return cached; }

  try {
    var tz = 'Africa/Cairo';
    var cutoff = Utilities.formatDate(new Date(Date.now() - days * 86400000), tz, 'yyyy-MM-dd');
    var messages = [];

    function asDate_(v) {
      return (v instanceof Date)
        ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
        : String(v || '').substring(0, 10);
    }

    // بنقرا من آخر الشيت للأول ونقف أول ما نخرج من المدة — أسرع بكتير
    /* ⚠️ إصلاح: النسخة القديمة كانت بتوقف أول ما تلاقي سطر أقدم من
       المدة — وده بيفترض إن الشيت مرتب بالتاريخ، وهو مش مرتب:
         • تلات شيتات بتتكتب بالتوازي (فواتير + كوبونات + ديون)
         • retrySMS بتعدّل سطور قديمة وترجّعها لآخر الشيت
         • السطر اللي تاريخه فاضي كان بيوقف القراءة فورًا ('' < cutoff)
       النتيجة كانت رسايل بتختفي من السجل من غير ما حد يعرف.

       دلوقتي بنقرا آخر 3000 سطر كاملين وبنفلتر بالتاريخ — من غير
       وقوف مبكر. الشيت مبيوصلش الحجم ده بسرعة، والقراءة دفعة واحدة
       أسرع من دفعات متتالية. */
    function tailRows_(sheet, cols) {
      if (!sheet || sheet.getLastRow() <= 1) return [];
      var last = sheet.getLastRow();
      var MAX = 3000;
      var start = Math.max(2, last - MAX + 1);
      var rows = sheet.getRange(start, 1, last - start + 1, cols).getValues();
      var out = [];
      for (var i = rows.length - 1; i >= 0; i--) {
        var d = asDate_(rows[i][0]);
        if (!d) continue;               /* تاريخ فاضي = نتخطاه مش نوقف */
        if (d < cutoff) continue;       /* بره المدة = نتخطاه مش نوقف */
        out.push(rows[i]);
      }
      return out;
    }

    // (أ) رسايل الفواتير
    tailRows_(getSMSLogSheet_(), 8).forEach(function (r) {
      messages.push({
        type: 'invoice', date: asDate_(r[0]), invoiceid: String(r[1]),
        customername: r[2], phone: String(r[3]), amount: r[4],
        message: r[5], status: r[6], attemptTime: r[7]
      });
    });

    // (ب) رسايل الكوبونات
    tailRows_(getCouponLogSheet_(), 6).forEach(function (r) {
      messages.push({
        type: 'coupon', date: asDate_(r[0]), invoiceid: '',
        customername: r[2], phone: String(r[1]), amount: '',
        message: r[3], status: r[4], attemptTime: r[5]
      });
    });

    // (ج) رسايل تذكير الديون
    tailRows_(getDebtReminderLogSheet_(), 6).forEach(function (r) {
      messages.push({
        type: 'debt', date: asDate_(r[0]), invoiceid: '',
        customername: r[2], phone: String(r[1]), amount: r[3],
        message: 'تذكير سداد: ' + r[3] + ' جنيه', status: r[4], attemptTime: r[5]
      });
    });

    // 🔧 الترتيب بالتاريخ الحقيقي مش بالنص — الصفوف متخزنة بصيغتين مختلفتين
    function ms_(v) {
      if (v instanceof Date) return v.getTime();
      var s = String(v || '').trim();
      if (!s) return 0;
      var t = new Date(s.replace(' ', 'T')).getTime();
      if (!isNaN(t)) return t;
      t = new Date(s).getTime();
      return isNaN(t) ? 0 : t;
    }
    messages.sort(function (a, b) { return ms_(b.attemptTime) - ms_(a.attemptTime); });

    var result = { ok: true, days: days, count: messages.length, messages: messages };
    fxCachePut_(cacheKey, result, 120); // دقيقتين
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}


// ═══════════════════════════════════════════════════════════════════
// ٢) الصفحة الرئيسية — نداء واحد بدل ٦
// ═══════════════════════════════════════════════════════════════════
function getHomeBundle() {
  var cached = fxCacheGet_('fx_home_bundle');
  if (cached) { cached.cached = true; return cached; }

  function safe_(label, fn) {
    try { return fn(); }
    catch (err) { return { ok: false, error: label + ': ' + err.message }; }
  }

  var out = {
    ok: true,
    daily:       safe_('daily',       function () { return getSystemDailyTotals(); }),
    maintenance: safe_('maintenance', function () { return getMaintenanceStatus(); }),
    attendance:  safe_('attendance',  function () { return getAttendanceLiveV2(); }),
    expiry:      safe_('expiry',      function () { return getExpiryByMonth(); }),
    agents:      safe_('agents',      function () { return getAgentsData(); }),
    debts:       safe_('debts',       function () { return fxDebtsCached_(); }),
    generated:   Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss')
  };

  fxCachePut_('fx_home_bundle', out, 60); // 🔧 كانت ٣ دقايق — قصّرناها عشان رقم النهاردة يوصل بسرعة
  return out;
}

// الديون بتقرا سنة من ملفات Drive — أتقل حاجة في السيستم
function fxDebtsCached_() {
  var cached = fxCacheGet_('fx_debts');
  if (cached) return cached;
  var d = getDebtsData();
  if (d && d.ok) fxCachePut_('fx_debts', d, 600); // ١٠ دقايق
  return d;
}