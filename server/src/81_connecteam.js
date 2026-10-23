// ==== MODULE 81_connecteam (split from server/Code.js; load order = file name order) ====



// ═══════════════════════════════════════════════════════════════════
// ٣) بصمة Connecteam — النسخة المصلّحة
// ═══════════════════════════════════════════════════════════════════

// بيدوّر على مفتاح جوه أي عمق، مهما كان شكل التغليف
function ctFind_(obj, key, depth) {
  depth = depth || 0;
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var found = ctFind_(obj[k], key, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function ctCall_(url) {
  // لو Connecteam حظرنا مؤقتًا، مش بنكمّل نداءات — بنستنى المهلة تخلص
  try {
    var until = PropertiesService.getScriptProperties().getProperty('ctBlockedUntil');
    if (until && Date.now() < parseInt(until, 10)) {
      return { ok: false, code: 429,
               error: 'الحضور مؤقتًا مش متاح — Connecteam حاظرنا لكتر الطلبات. هيرجع خلال دقايق.' };
    }
  } catch (e) {}

  var res = UrlFetchApp.fetch(url, {
    headers: { 'X-API-KEY': CONNECTEAM_API_KEY, 'accept': 'application/json' },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();

  if (code === 429) {
    // نوقف كل النداءات ٥ دقايق بدل ما نزوّد الحظر
    try {
      PropertiesService.getScriptProperties()
        .setProperty('ctBlockedUntil', String(Date.now() + 300000));
    } catch (e) {}
    return { ok: false, code: 429,
             error: 'الحضور مؤقتًا مش متاح — Connecteam حاظرنا لكتر الطلبات. هيرجع خلال دقايق.' };
  }
  if (code !== 200) {
    return { ok: false, code: code, error: 'Connecteam رجّع كود ' + code };
  }
  try { return { ok: true, code: code, json: JSON.parse(body) }; }
  catch (err) { return { ok: false, code: code, error: 'الرد مش JSON صالح' }; }
}

// أسماء الموظفين من Connecteam نفسه (كاش ٦ ساعات)
function ctUserMap_() {
  var cached = fxCacheGet_('ct_users');
  if (cached) return cached;

  var map = {};
  try {
    var offset = 0;
    for (var page = 0; page < 10; page++) {
      var r = ctCall_('https://api.connecteam.com/users/v1/users?limit=200&offset=' + offset);
      if (!r.ok) break;
      var users = ctFind_(r.json, 'users');
      if (!users || !users.length) break;
      users.forEach(function (u) {
        var id = String(u.userId || u.id || '');
        if (!id) return;
        var nm = [u.firstName, u.lastName].filter(function (x) { return x; }).join(' ').trim();
        map[id] = nm || u.fullName || u.name || ('موظف ' + id);
      });
      if (users.length < 200) break;
      offset += 200;
    }
  } catch (err) {}

  // أي اسم مكتوب يدوي في CONNECTEAM_USER_MAP بيغلب اللي جاي من الـAPI
  try { for (var k in CONNECTEAM_USER_MAP) map[k] = CONNECTEAM_USER_MAP[k]; } catch (err) {}

  if (Object.keys(map).length) fxCachePut_('ct_users', map, 21600);
  return map;
}

function ctName_(userId, map) {
  var id = String(userId || '');
  return (map && map[id]) ? map[id] : ('موظف ' + id);
}

// بيجيب الشيفتات الخام — بيفكّ التغليف وبيمشي على الصفحات
function ctGetShifts_(from, to) {
  var err = connecteamReady_();
  if (err) return { ok: false, error: err };

  var ck = 'ct_sh_' + from + '_' + to;
  var hit = fxCacheGet_(ck);
  if (hit) return hit;

  var all = [], offset = 0, lastError = '';
  for (var page = 0; page < 20; page++) {
    var url = 'https://api.connecteam.com/time-clock/v1/time-clocks/' + CONNECTEAM_TIME_CLOCK_ID +
      '/time-activities?startDate=' + from + '&endDate=' + to + '&limit=200&offset=' + offset;
    var r = ctCall_(url);
    if (!r.ok) { lastError = r.error; break; }

    var arr = ctFind_(r.json, 'timeActivitiesByUsers') || ctFind_(r.json, 'timeActivities');
    if (!arr || !arr.length) break;

    all = all.concat(arr);
    if (arr.length < 200) break;
    offset += 200;
  }

  if (!all.length && lastError) return { ok: false, error: lastError };
  var out = { ok: true, shifts: all };
  fxCachePut_(ck, out, 600);   // ١٠ دقايق — يمنع تكرار النداء على نفس الفترة
  return out;
}

// النسخة القديمة — سايبينها عشان أي كود تاني بينده عليها
function getConnecteamShifts_(from, to) {
  var r = ctGetShifts_(from, to);
  return r.ok ? r.shifts : [];
}

function ctShiftsOf_(entry) {
  var s = entry.shifts || entry.timeActivities || entry.activities || [];
  return (s && s.length !== undefined) ? s : [];
}

function ctTs_(point) {
  if (!point) return null;
  if (typeof point === 'number') return point;
  if (point.timestamp) return point.timestamp;
  if (point.time) return point.time;
  return null;
}

function getConnecteamHours(from, to) {
  try {
    var r = ctGetShifts_(from, to);
    if (!r.ok) return { ok: false, error: r.error };

    var map = ctUserMap_();
    var hoursByEmployee = {};

    r.shifts.forEach(function (entry) {
      var nm = ctName_(entry.userId, map);
      ctShiftsOf_(entry).forEach(function (sh) {
        var a = ctTs_(sh.start), b = ctTs_(sh.end);
        if (!a || !b) return; // شيفت لسه مفتوح، منحسبوش
        hoursByEmployee[nm] = (hoursByEmployee[nm] || 0) + ((b - a) / 3600);
      });
    });

    return { ok: true, hours: hoursByEmployee };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// مين موجود دلوقتي (شيفت مفتوح: فيه بداية ومفيش نهاية)
function getAttendanceLiveV2() {
  try {
    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var r = ctGetShifts_(today, today);
    if (!r.ok) return { ok: false, error: r.error };

    var map = ctUserMap_();
    var now = Math.floor(Date.now() / 1000);
    var live = [];

    r.shifts.forEach(function (entry) {
      var nm = ctName_(entry.userId, map);
      ctShiftsOf_(entry).forEach(function (sh) {
        var a = ctTs_(sh.start);
        if (!a || ctTs_(sh.end)) return;
        live.push({ name: nm, checkInTimestamp: a, elapsedMinutes: Math.round((now - a) / 60) });
      });
    });

    return { ok: true, live: live, count: live.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// سجل الحضور يوم بيوم
function getAttendanceHistoryV2(params) {
  try {
    params = params || {};
    var now = new Date(), tz = 'Africa/Cairo';
    var from, to, label;

    if (params.from && params.to) {
      from = params.from; to = params.to; label = params.from + ' → ' + params.to;
    } else if (params.range === 'today') {
      from = Utilities.formatDate(now, tz, 'yyyy-MM-dd'); to = from; label = 'اليوم';
    } else if (params.range === 'week') {
      from = Utilities.formatDate(new Date(now.getTime() - 7 * 86400000), tz, 'yyyy-MM-dd');
      to = Utilities.formatDate(now, tz, 'yyyy-MM-dd'); label = 'آخر أسبوع';
    } else if (params.range === 'lastMonth') {
      var y = now.getFullYear(), m = now.getMonth();
      from = Utilities.formatDate(new Date(y, m - 1, 1), tz, 'yyyy-MM-dd');
      to = Utilities.formatDate(new Date(y, m, 0), tz, 'yyyy-MM-dd'); label = 'الشهر اللي فات';
    } else {
      from = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth(), 1), tz, 'yyyy-MM-dd');
      to = Utilities.formatDate(now, tz, 'yyyy-MM-dd'); label = 'الشهر ده';
    }

    var r = ctGetShifts_(from, to);
    if (!r.ok) return { ok: false, error: r.error };

    var map = ctUserMap_();
    var rows = [];

    r.shifts.forEach(function (entry) {
      var nm = ctName_(entry.userId, map);
      ctShiftsOf_(entry).forEach(function (sh) {
        var a = ctTs_(sh.start);
        if (!a) return;
        var b = ctTs_(sh.end);
        var startD = new Date(a * 1000);
        var endD = b ? new Date(b * 1000) : null;
        rows.push({
          date: Utilities.formatDate(startD, tz, 'yyyy-MM-dd'),
          name: nm,
          checkIn: Utilities.formatDate(startD, tz, 'hh:mm a'),
          checkOut: endD ? Utilities.formatDate(endD, tz, 'hh:mm a') : 'مفتوح',
          durationMin: endD ? Math.round((b - a) / 60) : null
        });
      });
    });

    rows.sort(function (x, y) { return x.date.localeCompare(y.date) || x.name.localeCompare(y.name); });
    return { ok: true, label: label, from: from, to: to, rows: rows };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// الأسماء القديمة — سايبينها عشان أي كود قديم يفضل شغال
function getAttendanceLiveStatus() { return getAttendanceLiveV2(); }
function getAttendanceHistoryData(params) { return getAttendanceHistoryV2(params); }


// ═══════════════════════════════════════════════════════════════════
// ٤) الفحص الشامل — بيتنادى من زرار "ابدأ الفحص" في صفحة الصيانة
// ═══════════════════════════════════════════════════════════════════
function diagnoseAll() {
  var out = { ok: true, checks: [] };

  function add(name, ok, detail) {
    out.checks.push({ name: name, ok: !!ok, detail: String(detail || '') });
  }

  // ---- Connecteam ----
  var ready = null;
  try { ready = connecteamReady_(); } catch (err) { ready = err.message; }
  if (ready) {
    add('مفاتيح Connecteam', false, ready);
  } else {
    add('مفاتيح Connecteam', true, 'موجودة');

    var u = ctCall_('https://api.connecteam.com/users/v1/users?limit=5&offset=0');
    if (!u.ok) {
      add('الاتصال بـ Connecteam', false, u.error);
    } else {
      add('الاتصال بـ Connecteam', true, 'كود 200');
      var users = ctFind_(u.json, 'users');
      add('أسماء الموظفين', !!(users && users.length),
        (users && users.length) ? (users.length + ' موظف')
          : ('مفيش مفتاح users — المفاتيح الموجودة: ' + Object.keys(u.json).join(', ')));
    }

    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var monthAgo = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), 'Africa/Cairo', 'yyyy-MM-dd');
    var t = ctCall_('https://api.connecteam.com/time-clock/v1/time-clocks/' + CONNECTEAM_TIME_CLOCK_ID +
      '/time-activities?startDate=' + monthAgo + '&endDate=' + today + '&limit=5&offset=0');
    if (!t.ok) {
      add('قراءة البصمات', false, t.error);
    } else {
      var arr = ctFind_(t.json, 'timeActivitiesByUsers') || ctFind_(t.json, 'timeActivities');
      add('قراءة البصمات', !!arr,
        arr ? ('بصمات لـ ' + arr.length + ' موظف خلال ٣٠ يوم')
            : ('مفيش مفتاح بصمات. المفاتيح: ' + Object.keys(t.json).join(', ') +
               ' | الرد: ' + JSON.stringify(t.json).substring(0, 300)));
      var h = getAttendanceHistoryV2({ range: 'month' });
      add('سجل الحضور النهائي', h.ok && h.rows.length > 0,
        h.ok ? (h.rows.length + ' سطر') : h.error);
    }
  }

  // ---- الشيتات ----
  [['شيت الموظفين', STAFF_SHEET_ID], ['شيت العملاء', CRM_SHEET_ID], ['شيت المخزون', STOCK_SHEET_ID]]
    .forEach(function (pair) {
      try {
        add(pair[0], true, SpreadsheetApp.openById(pair[1]).getName());
      } catch (err) {
        add(pair[0], false, err.message);
      }
    });

  // ---- مجلد المبيعات ----
  try {
    add('مجلد ملفات المبيعات', true, DriveApp.getFolderById(SALES_FOLDER).getName());
  } catch (err) {
    add('مجلد ملفات المبيعات', false, err.message);
  }

  // ---- سرعة الرسايل ----
  try {
    var t0 = new Date().getTime();
    var sms = getSMSLogFast({ days: 30 });
    add('سجل الرسايل (٣٠ يوم)', sms.ok,
      sms.ok ? (sms.count + ' رسالة في ' + (new Date().getTime() - t0) + ' مللي ثانية' +
                (sms.cached ? ' — من الكاش' : '')) : sms.error);
  } catch (err) {
    add('سجل الرسايل', false, err.message);
  }

  // ---- التريجرات ----
  try {
    var liveOn = ScriptApp.getProjectTriggers().some(function (tr) {
      return tr.getHandlerFunction() === 'checkStaffOrders';
    });
    add('تريجر الفواتير الحي', liveOn, liveOn ? 'شغال كل دقيقة' : 'واقف — دوس "شغّل التريجر الحي"');
  } catch (err) {
    add('تريجر الفواتير الحي', false, err.message);
  }

  out.failed = out.checks.filter(function (c) { return !c.ok; }).length;
  return out;
}

// نفس الفحص بس بيطبع في الـLogs — لو حبيت تشغّله من المحرر
function diagnoseAllToLog() {
  var r = diagnoseAll();
  Logger.log('════ فحص شامل — ' + r.failed + ' مشكلة ════');
  r.checks.forEach(function (c) {
    Logger.log((c.ok ? '✅ ' : '❌ ') + c.name + ' — ' + c.detail);
  });
}

// النسخة القديمة من تشخيص Connecteam — بتطبع الرد الخام كامل
function diagnoseConnecteam() {
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var monthAgo = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), 'Africa/Cairo', 'yyyy-MM-dd');
  var r = ctCall_('https://api.connecteam.com/time-clock/v1/time-clocks/' + CONNECTEAM_TIME_CLOCK_ID +
    '/time-activities?startDate=' + monthAgo + '&endDate=' + today + '&limit=5&offset=0');
  Logger.log('كود الرد: ' + r.code);
  Logger.log('الرد كامل: ' + (r.ok ? JSON.stringify(r.json).substring(0, 3000) : r.error));
}