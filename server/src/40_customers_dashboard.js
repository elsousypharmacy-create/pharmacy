// ==== MODULE 40_customers_dashboard (split from server/Code.js; load order = file name order) ====


// 🩺 تشخيص شهري — يوم بيوم — بيوريك مبيعات وفواتير كل يوم لوحده في الـ Logs
function diagnoseLastMonthDays() {
  const folder = DriveApp.getFolderById(SALES_FOLDER);
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
  const dayCount = Math.round((last - first) / 86400000) + 1;

  let grandSales = 0, grandReturns = 0, grandInvoices = 0;
  Logger.log('📅 تشخيص ' + Utilities.formatDate(first, 'Africa/Cairo', 'yyyy-MM-dd') + ' → ' + Utilities.formatDate(last, 'Africa/Cairo', 'yyyy-MM-dd'));
  Logger.log('═══════════════════════════════');

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(first.getTime() + i * 86400000);
    const dateStr = Utilities.formatDate(d, 'Africa/Cairo', 'yyyy-MM-dd');

    const salesFiles = folder.getFilesByName('sales' + dateStr + '.txt');
    const hasSales = salesFiles.hasNext();
    const salesContent = hasSales ? salesFiles.next().getBlob().getDataAsString('UTF-8') : '';

    const returnFiles = folder.getFilesByName('Returnsales' + dateStr + '.txt');
    const hasReturns = returnFiles.hasNext();
    const returnsContent = hasReturns ? returnFiles.next().getBlob().getDataAsString('UTF-8') : '';

    if (!hasSales && !hasReturns) {
      Logger.log(dateStr + ' | ⚠️ الملفين مفقودين خالص');
      continue;
    }

    const stats = parseStaffStats(salesContent + '\n' + returnsContent, dateStr);
    let daySales = 0, dayReturns = 0, dayInvoices = 0;
    Object.keys(stats).forEach(function(emp) {
      daySales += stats[emp].sales;
      dayReturns += stats[emp].returns_value;
      dayInvoices += stats[emp].invoices.size;
    });

    grandSales += daySales; grandReturns += dayReturns; grandInvoices += dayInvoices;
    Logger.log(dateStr + ' | فواتير: ' + dayInvoices + ' | مبيعات: ' + Math.round(daySales) +
      ' | مرتجع: ' + Math.round(dayReturns) +
      (hasSales ? '' : ' | ⚠️ sales مفقود') + (hasReturns ? '' : ''));
  }

  Logger.log('═══════════════════════════════');
  Logger.log('📊 الإجمالي: فواتير ' + grandInvoices + ' | مبيعات (قبل المرتجع) ' + Math.round(grandSales) +
    ' | مرتجع ' + Math.round(grandReturns) + ' | صافي ' + Math.round(grandSales - grandReturns));
}

function getHeaderMap(sheet) {
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  header.forEach(function(h, i) { if (h) map[String(h).trim()] = i; });
  return map;
}

function isTruthy(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
}

function getCustomers() {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var sheet = ss.getSheetByName('Customers');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var map = getHeaderMap(sheet);
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, lastCol).getValues();

  function g(r, key, def) { return (map[key] !== undefined && r[map[key]] !== '') ? r[map[key]] : def; }

  return data.filter(function(r){ return map['phone'] !== undefined && r[map['phone']]; }).map(function(r){
    return {
      phone: String(g(r,'phone','')),
      name: g(r,'name',''),
      cls: g(r,'cls',''),
      monthly_visits: g(r,'monthly_visits',0),
      monthly_spend: g(r,'monthly_spend',0),
      days_since: g(r,'days_since',null),   /* null = مفيش بيانات، مش "النهاردة" */
      alert_days: g(r,'alert_days',30),
      incentive: g(r,'incentive',0),
      status: g(r,'status',''),
      customer_type: g(r,'customer_type','عرضي'),
      follow_up_count: g(r,'follow_attempts',0),
      last_contact_date: g(r,'contact_marked_at',''),
      is_blocked: isTruthy(g(r,'blocked',false))
    };
  });
}

/* ملف العميل: آخر مشتريات (من فواتير البيع) + الدين الحالي. بيمشي من الأحدث للأقدم ويقف بعد 5 فواتير. */
function getCustomerProfile(phone) {
  try {
    var canon = canonicalEgyptPhone_(phone);
    if (!canon) return { ok: false, error: 'رقم غير صالح' };
    var ck = 'fx_cprof_' + canon;
    var hit = fxCacheGet_(ck);
    if (hit) return hit;

    var folder = DriveApp.getFolderById(SALES_FOLDER);
    var tz = 'Africa/Cairo', today = new Date(), t0 = Date.now();
    var purchases = [], scanned = 0, MAXDAYS = 90;

    for (var i = 0; i < MAXDAYS && purchases.length < 5; i++) {
      if (Date.now() - t0 > 24000) break;   /* حماية من مهلة السكربت */
      var dateStr = Utilities.formatDate(new Date(today.getTime() - i * 86400000), tz, 'yyyy-MM-dd');
      var files = folder.getFilesByName('sales' + dateStr + '.txt');
      if (!files.hasNext()) continue;
      var content = files.next().getBlob().getDataAsString('UTF-8');
      scanned++;
      if (!content || content.indexOf(canon.substring(1)) === -1) continue;   /* فلتر سريع */

      var inv = {}, rx = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
      while ((m = rx.exec(content)) !== null) {
        var tuples = extractTuples('(' + m[1] + ')');
        for (var t = 0; t < tuples.length; t++) {
          try {
            var v = parseValues(tuples[t]);
            if (!v || v.length < 50) continue;
            if ((v[2] ? v[2].trim() : '') !== 'sale') continue;
            if (canonicalEgyptPhone_(v[45]) !== canon) continue;
            var id = v[1];
            if (!inv[id]) inv[id] = { date: dateStr, invoice: id, items: [], total: 0 };
            inv[id].items.push({ name: (v[6] ? v[6].trim() : (v[5] ? v[5].trim() : '؟')),
                                 qty: parseFloat(v[7]) || 0 });
            inv[id].total = (parseFloat(v[35]) || 0) + (parseFloat(v[39]) || 0);
          } catch (e) { continue; }
        }
      }
      Object.keys(inv).sort(function (a, b) { return parseInt(b) - parseInt(a); })
        .forEach(function (id) { if (purchases.length < 5) purchases.push(inv[id]); });
    }

    var debt = null;
    try {
      var d = getDebtsSnap();
      (d && d.debtors || []).forEach(function (c) {
        if (canonicalEgyptPhone_(c.phone) === canon) debt = { net: c.net, daysSincePaid: c.daysSincePaid };
      });
    } catch (e2) {}

    var out = { ok: true, phone: canon, purchases: purchases, debt: debt,
                scannedDays: scanned, partial: (Date.now() - t0 > 24000) };
    fxCachePut_(ck, out, 1800);
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ═══ زيارات العملاء لفترة ═══
   كل يوم فات بيتحسب مرة واحدة ويتحفظ في شيت "زيارات يومية" (التاريخ | JSON {رقم:[فواتير, إنفاق]}).
   الزيارة = يوم فيه فاتورة بيع على رقم العميل. النهاردة بيتحسب لحظي ومش بيتحفظ. */
var VISITS_SHEET = 'زيارات يومية';

function visitDay_(folder, dateStr) {
  var files = folder.getFilesByName('sales' + dateStr + '.txt');
  if (!files.hasNext()) return {};
  var content = files.next().getBlob().getDataAsString('UTF-8');
  if (!content) return {};
  var inv = {}, rx = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
  while ((m = rx.exec(content)) !== null) {
    var tuples = extractTuples('(' + m[1] + ')');
    for (var t = 0; t < tuples.length; t++) {
      try {
        var v = parseValues(tuples[t]);
        if (!v || v.length < 50) continue;
        if ((v[2] ? v[2].trim() : '') !== 'sale') continue;
        var ph = canonicalEgyptPhone_(v[45]);
        if (!ph || ph.length < 10) continue;
        inv[v[1]] = { p: ph, s: (parseFloat(v[35]) || 0) + (parseFloat(v[39]) || 0) };
      } catch (e) { continue; }
    }
  }
  var out = {};
  Object.keys(inv).forEach(function (id) {
    var x = inv[id];
    if (!out[x.p]) out[x.p] = [0, 0];
    out[x.p][0]++; out[x.p][1] = Math.round((out[x.p][1] + x.s) * 100) / 100;
  });
  return out;
}

function getCustomerVisits(days) {
  try {
    days = parseInt(days, 10);
    if ([30, 60, 90, 180, 365].indexOf(days) === -1) days = 30;
    var ck = 'fx_cvis_' + days, hit = fxCacheGet_(ck);
    if (hit) return hit;

    var tz = 'Africa/Cairo', t0 = Date.now(), now = new Date();
    var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var folder = DriveApp.getFolderById(SALES_FOLDER);
    var sh = getOrCreateSheet_(VISITS_SHEET, ['التاريخ', 'زيارات']);
    sh.getRange('A:A').setNumberFormat('@');
    var stored = {};
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
        try { stored[String(r[0]).substring(0, 10)] = JSON.parse(r[1] || '{}'); } catch (e) {}
      });
    }

    var agg = {}, missing = 0, add = [], from = '';
    function addDay(d, map) {
      Object.keys(map).forEach(function (ph) {
        var a = agg[ph] || (agg[ph] = { v: 0, n: 0, s: 0, l: '' });
        a.v++; a.n += map[ph][0]; a.s += map[ph][1];
        if (d > a.l) a.l = d;
      });
    }
    for (var i = days - 1; i >= 0; i--) {
      var d = Utilities.formatDate(new Date(now.getTime() - i * 86400000), tz, 'yyyy-MM-dd');
      if (!from) from = d;
      if (d === today) { try { addDay(d, visitDay_(folder, d)); } catch (e) {} continue; }
      if (stored[d]) { addDay(d, stored[d]); continue; }
      if (Date.now() - t0 > 22000) { missing++; continue; }   /* الباقي في النداء الجاي */
      var map = {};
      try { map = visitDay_(folder, d); } catch (e) {}
      add.push([d, JSON.stringify(map)]);
      addDay(d, map);
    }
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 2).setValues(add);

    Object.keys(agg).forEach(function (k) { agg[k].s = Math.round(agg[k].s); });
    var out = { ok: true, days: days, from: from, to: today, missingDays: missing, customers: agg };
    if (!missing) fxCachePut_(ck, out, 1800);
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getHistory(phone) {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var sheet = ss.getSheetByName('History');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 7).getValues();
  return data
    .filter(function(r){return String(r[1]) === String(phone);})
    .map(function(r){return {timestamp:r[0],phone:r[1],name:r[2],type:r[3],text:r[4],result:r[5],note:r[6]};})
    .reverse().slice(0,20);
}

function saveHistory(data) {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  ss.getSheetByName('History').appendRow([
    new Date().toISOString(), data.phone, data.name, data.type, data.text, data.result, data.note||''
  ]);
  registerFollowUpContact(ss, data.phone, data.result);
}

function registerFollowUpContact(ss, phone, result) {
  var custSheet = ss.getSheetByName('Customers');
  if (!custSheet || custSheet.getLastRow() <= 1) return;
  var map = getHeaderMap(custSheet);
  var lastCol = custSheet.getLastColumn();
  var data = custSheet.getRange(2, 1, custSheet.getLastRow()-1, lastCol).getValues();

  for (var i = 0; i < data.length; i++) {
    if (map['phone'] === undefined || String(data[i][map['phone']]) !== String(phone)) continue;
    var rowIndex = i + 2;
    var status = map['status'] !== undefined ? data[i][map['status']] : '';
    var isBlocked = map['blocked'] !== undefined ? isTruthy(data[i][map['blocked']]) : false;
    if (isBlocked) return;

    if (result === 'bought') {
      if (map['status'] !== undefined) custSheet.getRange(rowIndex, map['status']+1).setValue('نشط');
      if (map['follow_attempts'] !== undefined) custSheet.getRange(rowIndex, map['follow_attempts']+1).setValue(0);
      if (map['contact_marked_at'] !== undefined) custSheet.getRange(rowIndex, map['contact_marked_at']+1).setValue('');
      if (map['follow_deadline'] !== undefined) custSheet.getRange(rowIndex, map['follow_deadline']+1).setValue('');
      return;
    }
    if (status === 'تنبيه' && map['status'] !== undefined) {
      custSheet.getRange(rowIndex, map['status']+1).setValue('تمت المتابعة - في الانتظار');
    }
    if (map['contact_marked_at'] !== undefined) {
      custSheet.getRange(rowIndex, map['contact_marked_at']+1).setValue(new Date().toISOString());
    }
    if (map['follow_attempts'] !== undefined) {
      var cur = parseInt(data[i][map['follow_attempts']]) || 0;
      custSheet.getRange(rowIndex, map['follow_attempts']+1).setValue(cur + 1);
    }
    return;
  }
}

function getBlockedCustomers() {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var sheet = ss.getSheetByName('Customers');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var map = getHeaderMap(sheet);
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, lastCol).getValues();
  if (map['blocked'] === undefined) return [];
  return data.filter(function(r){ return isTruthy(r[map['blocked']]); }).map(function(r){
    return {
      phone: String(r[map['phone']]),
      name: r[map['name']],
      cls: r[map['cls']],
      blocked_reason: map['blocked_reason'] !== undefined ? (r[map['blocked_reason']] || '') : ''
    };
  });
}

function setCustomerBlocked(phone, blocked) {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var custSheet = ss.getSheetByName('Customers');
  if (!custSheet || custSheet.getLastRow() <= 1) return;
  var map = getHeaderMap(custSheet);
  var lastCol = custSheet.getLastColumn();
  var data = custSheet.getRange(2, 1, custSheet.getLastRow()-1, lastCol).getValues();

  for (var i = 0; i < data.length; i++) {
    if (map['phone'] === undefined || String(data[i][map['phone']]) !== String(phone)) continue;
    var rowIndex = i + 2;
    if (map['blocked'] !== undefined) custSheet.getRange(rowIndex, map['blocked']+1).setValue(blocked);
    if (map['status'] !== undefined) {
      custSheet.getRange(rowIndex, map['status']+1).setValue(blocked ? 'محظور' : 'نشط');
    }
    if (!blocked) {
      if (map['follow_attempts'] !== undefined) custSheet.getRange(rowIndex, map['follow_attempts']+1).setValue(0);
      if (map['contact_marked_at'] !== undefined) custSheet.getRange(rowIndex, map['contact_marked_at']+1).setValue('');
    }
    return;
  }
}

function getDashboard(params) {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var custSheet = ss.getSheetByName('Customers');
  var rawSheet = ss.getSheetByName('RawSales');
  var histSheet = ss.getSheetByName('History');

  var fromStr = params.from || Utilities.formatDate(new Date(0), 'Africa/Cairo', 'yyyy-MM-dd');
  var toStr = params.to || Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var from = new Date(fromStr + 'T00:00:00');
  var to = new Date(toStr + 'T23:59:59');

  var rawData = (rawSheet && rawSheet.getLastRow() > 1) ? rawSheet.getRange(2, 1, rawSheet.getLastRow()-1, 6).getValues() : [];
  var customerDates = {};
  rawData.forEach(function(r) {
    var ts = r[0], phone = String(r[1]);
    if (!ts || !phone) return;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return;
    if (!customerDates[phone]) customerDates[phone] = [];
    customerDates[phone].push(d);
  });

  var custMap = custSheet ? getHeaderMap(custSheet) : {};
  var custLastCol = custSheet ? custSheet.getLastColumn() : 0;
  var custData = (custSheet && custSheet.getLastRow() > 1) ? custSheet.getRange(2, 1, custSheet.getLastRow()-1, custLastCol).getValues() : [];
  var newCustomers = 0, purchasing = 0, returnCustomers = 0, lossCustomers = 0;
  var openAlerts = 0, pendingFollowups = 0, failedFollowups = 0, blockedCount = 0;

  custData.forEach(function(r) {
    var phone = String(r[custMap['phone']]);
    var status = r[custMap['status']];
    var alertDays = r[custMap['alert_days']] || 30;
    var followUpCount = r[custMap['follow_attempts']] || 0;
    var isBlocked = custMap['blocked'] !== undefined ? isTruthy(r[custMap['blocked']]) : false;
    var dates = customerDates[phone] || [];
    var inPeriod = dates.filter(function(d){ return d >= from && d <= to; });
    var beforePeriod = dates.filter(function(d){ return d < from; });

    if (inPeriod.length > 0) purchasing++;

    var firstEver = dates.length ? new Date(Math.min.apply(null, dates)) : null;
    if (firstEver && firstEver >= from && firstEver <= to) newCustomers++;

    if (beforePeriod.length > 0 && inPeriod.length > 0) {
      var lastBefore = new Date(Math.max.apply(null, beforePeriod));
      if ((from - lastBefore) / 86400000 > alertDays) returnCustomers++;
    }
    if (beforePeriod.length > 0 && inPeriod.length === 0) {
      var lastAny = new Date(Math.max.apply(null, dates));
      if ((to - lastAny) / 86400000 > alertDays) lossCustomers++;
    }

    if (isBlocked) { blockedCount++; if (followUpCount >= FOLLOWUP_MAX_ATTEMPTS) failedFollowups++; }
    else if (status === 'تنبيه') openAlerts++;
    else if (status === 'تمت المتابعة - في الانتظار') pendingFollowups++;
  });

  var totalActive = custData.length;
  var returnRate = totalActive > 0 ? Math.round(returnCustomers / totalActive * 100) : 0;
  var lossRate = totalActive > 0 ? Math.round(lossCustomers / totalActive * 100) : 0;

  var histData = (histSheet && histSheet.getLastRow() > 1) ? histSheet.getRange(2, 1, histSheet.getLastRow()-1, 7).getValues() : [];
  var commTotal = 0, byType = { wa: 0, call: 0, sms: 0, note: 0 }, bought = 0, responded = 0;
  histData.forEach(function(r) {
    var ts = r[0];
    var d = ts ? new Date(ts) : null;
    if (!d || isNaN(d.getTime()) || d < from || d > to) return;
    commTotal++;
    var type = r[3];
    if (byType[type] !== undefined) byType[type]++;
    var result = r[5];
    if (result === 'bought') { bought++; responded++; }
    else if (result === 'answered' || result === 'later') responded++;
  });
  var responseRate = commTotal > 0 ? Math.round(responded / commTotal * 100) : 0;

  return {
    open_alerts: openAlerts,
    pending_followups: pendingFollowups,
    failed_followups: failedFollowups,
    blocked_count: blockedCount,
    range: { from: fromStr, to: toStr },
    new_customers: newCustomers,
    return_rate: returnRate,
    returning_customers: returnCustomers,
    purchasing_customers_in_range: purchasing,
    loss_rate: lossRate,
    lost_customers: lossCustomers,
    comm: {
      total: commTotal,
      by_type: byType,
      bought: bought,
      response_rate: responseRate
    }
  };
}