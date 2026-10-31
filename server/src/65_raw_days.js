// ==== MODULE 65_raw_days: أرقام كل يوم من ملفات نظام البيع الخام (المصدر الأدق) ====
// شيت الموظفين بيتحدّث لحظيًا بس بيفوّته فواتير (اتأكدنا: أوائل أكتوبر الربح أقل بـ 10–25%).
// الأيام اللي خلصت بتتحسب من الملف الكامل، وبتتحفظ 6 ساعات.

function rawDay_(dateStr) {
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var ck = 'rawday3_' + dateStr, cache = CacheService.getScriptCache();
  if (dateStr < today) { var c = cache.get(ck); if (c) return JSON.parse(c); }
  var folder = DriveApp.getFolderById(SALES_FOLDER);
  var read = function (name) { var it = folder.getFilesByName(name); return it.hasNext() ? it.next().getBlob().getDataAsString('UTF-8') : ''; };
  var content = read('sales' + dateStr + '.txt') + '\n' + read('Returnsales' + dateStr + '.txt');
  var out = { date: dateStr, gross: 0, ret: 0, net: 0, profit: 0, invoices: 0, returns: 0, disc: 0, visits: 0, has: false };
  if (content.length < 20) return out;
  var seen = {}, phones = {}, noPhone = 0;
  var re = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
  while ((m = re.exec(content)) !== null) {
    var tuples = extractTuples('(' + m[1] + ')');
    for (var t = 0; t < tuples.length; t++) {
      var v; try { v = parseValues(tuples[t]); } catch (e) { continue; }
      if (!v || v.length < 55) continue;
      var type = String(v[2]).trim(); if (type !== 'sale' && type !== 'return') continue;
      var ben = parseFloat(v[54]) || 0;
      out.profit += type === 'sale' ? ben : -ben;
      var key = v[1] + '_' + type; if (seen[key]) continue; seen[key] = 1;
      var paid = (parseFloat(v[35]) || 0) + (parseFloat(v[39]) || 0);
      if (type === 'sale') {
        out.invoices++; out.gross += paid; out.disc += parseFloat(v[27]) || 0;
        var ph = String(v[45] || '').trim();
        if (ph.length > 3) phones[ph] = 1; else noPhone++;
      } else { out.returns++; out.ret += paid; }
    }
  }
  out.has = out.invoices > 0 || out.returns > 0;
  out.visits = Object.keys(phones).length + noPhone;
  ['gross', 'ret', 'profit', 'disc'].forEach(function (k) { out[k] = Math.round(out[k]); });
  out.net = out.gross - out.ret;
  if (dateStr < today) try { cache.put(ck, JSON.stringify(out), 21600); } catch (e) {}
  return out;
}

function getDailyRaw(p) {
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var from = String(p.from || ''), to = String(p.to || today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return { ok: false, error: 'التاريخ غلط' };
  var days = [], d = new Date(from + 'T12:00:00Z'), end = new Date(to + 'T12:00:00Z');
  for (var i = 0; d <= end && i < 62; i++) {
    var ds = d.toISOString().slice(0, 10);
    if (ds < today) days.push(rawDay_(ds));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { ok: true, from: from, to: to, days: days };
}
