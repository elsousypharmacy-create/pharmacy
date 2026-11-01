// ==== MODULE 69_closing — التقفيل يوم بيومه ووسائل الدفع (من ملفات نظام البيع الخام) ====
/* كل فاتورة في ملف المبيعات فيها وسيلة الدفع (cashway1/cashway2) والمبلغ (paid1/paid2):
     1 = كاش · 2 = آجل (دين) · 3 = كارت بنكي
   اتأكدنا إنها بتطابق تقفيل النظام بالمليم (31 أكتوبر: كاش 5225.96 · آجل 1362.54 · كارت 1087.05).
   المرتجعات بتتخصم من الكاش زي النظام، وتحصيل الديون من ملف الديون. */
var CLOSE_PDF_FOLDER_ = '19EZWuzPtOIyr-9mpEKTKiKqeIylZ5a3v';   // PDF التقفيل اليومي اللي النظام بيرفعه على الدرايف

function closingDay_(dateStr) {
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var ck = 'close1_' + dateStr, cache = CacheService.getScriptCache();
  if (dateStr < today) { var c = cache.get(ck); if (c) return JSON.parse(c); }
  var folder = DriveApp.getFolderById(SALES_FOLDER);
  var read = function (name) { var it = folder.getFilesByName(name); return it.hasNext() ? it.next().getBlob().getDataAsString('UTF-8') : ''; };
  var sales = read('sales' + dateStr + '.txt') + '\n' + read('Returnsales' + dateStr + '.txt');
  var debits = read('debits' + dateStr + '.txt');
  var by = {}, ret = 0, retN = 0, inv = 0, collected = 0, seen = {};
  var re = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
  while ((m = re.exec(sales)) !== null) {
    var tuples = extractTuples('(' + m[1] + ')');
    for (var t = 0; t < tuples.length; t++) {
      var v; try { v = parseValues(tuples[t]); } catch (e) { continue; }
      if (!v || v.length < 56) continue;
      var type = String(v[2]).trim(); if (type !== 'sale' && type !== 'return') continue;
      var key = v[1] + '_' + type; if (seen[key]) continue; seen[key] = 1;
      if (type === 'return') { ret += (parseFloat(v[35]) || 0) + (parseFloat(v[39]) || 0); retN++; continue; }
      inv++;
      var p1 = parseFloat(v[37]) || 0, p2 = parseFloat(v[39]) || 0;
      var w1 = String(v[36]).trim() || '1', w2 = String(v[38]).trim() || '1';
      if (p1) by[w1] = (by[w1] || 0) + p1;
      if (p2) by[w2] = (by[w2] || 0) + p2;
    }
  }
  var cp = /([^\n(]{2,40})\s*\(([0-9+]{2,})\)\s*[\r\n]+\s*إجمالى الديون قبل\s*(-?[\d.]+)\s*[\r\n]+\s*إجمالى الديون بعد\s*(-?[\d.]+)/g, q;
  while ((q = cp.exec(debits)) !== null) {
    var before = parseFloat(q[3]) || 0, after = parseFloat(q[4]) || 0;
    if (before > after) collected += before - after;
  }
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  var cash = by['1'] || 0, credit = by['2'] || 0, card = by['3'] || 0, other = {};
  Object.keys(by).forEach(function (k) { if (k !== '1' && k !== '2' && k !== '3') other[k] = r2(by[k]); });
  var otherSum = Object.keys(other).reduce(function (s, k) { return s + other[k]; }, 0);
  var gross = cash + credit + card + otherSum, cashNet = cash - ret;
  var out = {
    date: dateStr, has: inv > 0 || retN > 0, invoices: inv, returns_n: retN,
    cash: r2(cash), credit: r2(credit), card: r2(card), other: other, gross: r2(gross),
    ret: r2(ret), net: r2(gross - ret), cash_net: r2(cashNet), collected: r2(collected),
    expected_cash: r2(cashNet + collected)   // اللي المفروض يبقى في الدرج من حركة اليوم (من غير العهدة)
  };
  if (dateStr < today) try { cache.put(ck, JSON.stringify(out), 21600); } catch (e2) {}
  return out;
}

function getClosingDays(p) {
  try {
    var days = Math.max(1, Math.min(parseInt((p && p.days) || 7, 10) || 7, 21));
    var tz = 'Africa/Cairo', now = new Date(), list = [], dates = [];
    for (var i = 0; i < days; i++) dates.push(Utilities.formatDate(new Date(now.getTime() - i * 86400000), tz, 'yyyy-MM-dd'));
    var oldest = dates[dates.length - 1], pdf = {};
    try {
      var fit = DriveApp.getFolderById(CLOSE_PDF_FOLDER_).searchFiles("title contains 'dailyclose_' and modifiedDate > '" +
        Utilities.formatDate(new Date(now.getTime() - (days + 3) * 86400000), tz, 'yyyy-MM-dd') + "'");
      while (fit.hasNext()) {
        var f = fit.next(), mm = /dailyclose_(\d{4}-\d{2}-\d{2})_/.exec(f.getName());
        if (mm) pdf[mm[1]] = f.getUrl();
      }
    } catch (eP) {}
    dates.forEach(function (d) {
      var x = closingDay_(d); if (!x.has) return;
      x.pdf = pdf[d] || '';
      list.push(x);
    });
    var tot = { cash: 0, credit: 0, card: 0, ret: 0, collected: 0, gross: 0 };
    list.forEach(function (x) { Object.keys(tot).forEach(function (k) { tot[k] += x[k] || 0; }); });
    Object.keys(tot).forEach(function (k) { tot[k] = Math.round(tot[k] * 100) / 100; });
    return { ok: true, days: list, totals: tot, from: oldest, to: dates[0] };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
