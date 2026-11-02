// ==== MODULE 69_closing_pdf — قراءة PDF تقفيل النظام (جداول النظام / المستخدم / الفارق) من غير OCR ====
/* ملفات التقفيل بيعملها نظام البيع (dompdf): النص جواها عادي مش صورة، كل خلية = BT x y Td ... [(نص)] TJ ET
   والحروف بتتكتب كل حرف في بايتين (Unicode) وبترتيب بصري معكوس — فبنفك الضغط (inflate)، وبنقرا الخلايا
   بإحداثياتها، وبنربط كل صف باسمه العربي. */
function pdfInflate_(src) {
  var pos = 2, bitBuf = 0, bitCnt = 0, out = [];
  var LB = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LE = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DB = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DE = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  function bits(n) {
    while (bitCnt < n) { if (pos >= src.length) throw new Error('inflate: انتهى'); bitBuf |= (src[pos++] & 255) << bitCnt; bitCnt += 8; }
    var v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v;
  }
  function build(lens) {            // جدول هوفمان (canonical)
    var count = [], offs = [], syms = [], i;
    for (i = 0; i < 16; i++) count[i] = 0;
    for (i = 0; i < lens.length; i++) count[lens[i]]++;
    count[0] = 0; offs[1] = 0;
    for (i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
    for (i = 0; i < lens.length; i++) if (lens[i]) syms[offs[lens[i]]++] = i;
    return { count: count, syms: syms };
  }
  function decode(h) {
    var code = 0, first = 0, index = 0;
    for (var len = 1; len < 16; len++) {
      code |= bits(1);
      var c = h.count[len];
      if (code - c < first) return h.syms[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('inflate: كود غلط');
  }
  var fixedL = null, fixedD = null;
  function fixed() {
    if (!fixedL) {
      var l = [], i;
      for (i = 0; i < 144; i++) l[i] = 8; for (; i < 256; i++) l[i] = 9; for (; i < 280; i++) l[i] = 7; for (; i < 288; i++) l[i] = 8;
      fixedL = build(l); var d = []; for (i = 0; i < 30; i++) d[i] = 5; fixedD = build(d);
    }
  }
  function codes(hl, hd) {
    for (;;) {
      var s = decode(hl);
      if (s < 256) out.push(s);
      else if (s === 256) return;
      else {
        s -= 257; if (s > 28) throw new Error('inflate: طول غلط');
        var len = LB[s] + bits(LE[s]);
        var ds = decode(hd); if (ds > 29) throw new Error('inflate: مسافة غلط');
        var dist = DB[ds] + bits(DE[ds]);
        if (dist > out.length) throw new Error('inflate: مسافة أبعد من اللازم');
        for (var k = 0; k < len; k++) out.push(out[out.length - dist]);
      }
    }
  }
  var last;
  do {
    last = bits(1); var type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      var n = (src[pos] & 255) | ((src[pos + 1] & 255) << 8); pos += 4;
      for (var j = 0; j < n; j++) out.push(src[pos++] & 255);
    } else if (type === 1) { fixed(); codes(fixedL, fixedD); }
    else if (type === 2) {
      var nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4, ord = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15], lens = [], i2;
      for (i2 = 0; i2 < 19; i2++) lens[i2] = 0;
      for (i2 = 0; i2 < nc; i2++) lens[ord[i2]] = bits(3);
      var hc = build(lens), all = [];
      while (all.length < nl + nd) {
        var sym = decode(hc);
        if (sym < 16) all.push(sym);
        else {
          var rep, val = 0;
          if (sym === 16) { val = all[all.length - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          while (rep--) all.push(val);
        }
      }
      codes(build(all.slice(0, nl)), build(all.slice(nl)));
    } else throw new Error('inflate: نوع بلوك غلط');
  } while (!last);
  return out;
}

function pdfBin_(bytes) {            // مصفوفة بايتات (ممكن تكون signed من جوجل) → نص بايناري
  var s = '';
  for (var i = 0; i < bytes.length; i += 4000) {
    var part = [], end = Math.min(bytes.length, i + 4000);
    for (var j = i; j < end; j++) part.push(bytes[j] & 255);
    s += String.fromCharCode.apply(null, part);
  }
  return s;
}
function pdfContent_(bin) {          // بيرجّع نص صفحة (content stream) من الملف البايناري
  var re = /stream\r?\n/g, m, out = '';
  while ((m = re.exec(bin)) !== null) {
    var start = m.index + m[0].length, end = bin.indexOf('endstream', start);
    if (end < 0) break;
    var dict = bin.slice(Math.max(0, m.index - 300), m.index), at = dict.lastIndexOf('<<');
    dict = at >= 0 ? dict.slice(at) : dict;
    re.lastIndex = end;
    if (dict.indexOf('/FlateDecode') < 0 || dict.indexOf('/Length1') >= 0 || end - start > 30000) continue;
    var raw = []; for (var k = start; k < end; k++) raw.push(bin.charCodeAt(k));
    try { var txt = pdfBin_(pdfInflate_(raw)); if (txt.indexOf(' TJ') >= 0) out += txt + '\n'; } catch (e) {}
  }
  return out;
}
function pdfLit_(s) {                // محتوى string literal في PDF (بـ escapes) → مصفوفة بايتات
  var o = [], i = 0;
  while (i < s.length) {
    var c = s.charCodeAt(i++);
    if (c !== 92) { o.push(c); continue; }
    var d = s.charAt(i++);
    if (d === 'n') o.push(10); else if (d === 'r') o.push(13); else if (d === 't') o.push(9);
    else if (d === 'b') o.push(8); else if (d === 'f') o.push(12);
    else if (d >= '0' && d <= '7') { var v = d; while (v.length < 3 && s.charAt(i) >= '0' && s.charAt(i) <= '7') v += s.charAt(i++); o.push(parseInt(v, 8) & 255); }
    else if (d === '\r' || d === '\n') { if (d === '\r' && s.charAt(i) === '\n') i++; }
    else o.push(d.charCodeAt(0));
  }
  return o;
}
function pdfRuns_(content) {         // كل الخلايا: {x, y, cps}
  var re = /BT\s+([\d.\-]+)\s+([\d.\-]+)\s+Td\s+\/F\d+\s+[\d.]+\s+Tf\s+\[\(((?:\\[\s\S]|[^\\)])*)\)\]\s*TJ\s+ET/g, m, runs = [];
  while ((m = re.exec(content)) !== null) {
    var b = pdfLit_(m[3]), cps = [];
    if (b.length % 2 === 0) for (var i = 0; i < b.length; i += 2) cps.push((b[i] << 8) | b[i + 1]); else cps = b;
    runs.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), cps: cps });
  }
  return runs;
}
function pdfNum_(r) {                // خلية أرقام → رقم
  var t = String.fromCharCode.apply(null, r.cps).replace(/[^0-9.\-]/g, '');
  var n = parseFloat(t); return isFinite(n) ? n : null;
}
function pdfAr_(r) {                 // خلية عربي (ترتيب بصري معكوس + أشكال عرض) → حروف مبسّطة للمقارنة
  var s = String.fromCharCode.apply(null, r.cps.slice().reverse()).normalize('NFKC');
  return s.replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
          .replace(/[^ء-ي.]/g, '').replace(/\./g, '');
}
var PDF_ROWS_ = [   // [المفتاح، جزء من الاسم، عدد الأرقام]  — الترتيب مهم (الأطول الأول)
  ['drawer', 'كلالكاشالموجودبالدرج', 3], ['sales_cash', 'كاشمنالمبيعات', 3], ['collected_cash', 'كاشمحصل', 3],
  ['custody', 'عهدهالكاشير', 3], ['bank_card', 'كارتبنك', 3], ['companies', 'الشركات', 3],
  ['debts', 'الديون', 1], ['discount', 'الخصم', 1], ['returns', 'ارجاعالاصناف', 1], ['expenses', 'اجماليالمصروفات', 1],
  ['stock_net', 'نتالمخزون', 1], ['stock_net', 'المخزوننت', 1], ['stock', 'المخزون', 1], ['profit', 'الارباح', 1]
];
function pdfParseClose_(content) {   // بيرجّع {rows:{key:{sys,user,diff}|{v}}, closed_at}
  var runs = pdfRuns_(content), lines = {};
  runs.forEach(function (r) { var k = Math.round(r.y * 2) / 2; (lines[k] = lines[k] || []).push(r); });
  var out = { rows: {}, found: 0 };
  Object.keys(lines).forEach(function (k) {
    var rs = lines[k].sort(function (a, b) { return a.x - b.x; }), label = '', nums = [];
    rs.forEach(function (r) { if (r.x < 250) label += pdfAr_(r); else { var n = pdfNum_(r); if (n !== null) nums.push(n); } });
    if (!label) return;
    var rawTxt = rs.filter(function (r) { return r.x >= 250; }).map(function (r) { return String.fromCharCode.apply(null, r.cps); }).join(' ').trim();
    if (label.indexOf('الدكتور') === 0 && rawTxt) { out.closed_at = rawTxt; return; }
    for (var i = 0; i < PDF_ROWS_.length; i++) {
      var d = PDF_ROWS_[i];
      if (label.indexOf(d[1]) < 0 || out.rows[d[0]]) continue;
      if (d[2] === 3 && nums.length >= 3) out.rows[d[0]] = { sys: nums[0], user: nums[1], diff: nums[2] };
      else if (d[2] === 1 && nums.length >= 1) out.rows[d[0]] = { v: nums[nums.length - 1] };
      else break;
      out.found++; break;
    }
  });
  return out;
}

var CLOSE_SHIFT_FOLDER_ = '1byAiIt5nBO483x_mKJVHkB2bI_t-84V9';   // PDF تقفيل كل وردية
/* بيقرا تقفيل يوم (اليومي + ورديّاته) من الدرايف. اليوم المقفول مابيتغيّرش فبيتخزن (٦٠ يوم بس عشان حد التخزين). */
function closingPdfRead_(dateStr) {
  var P = PropertiesService.getScriptProperties(), key = 'CLP2_' + dateStr;
  var read = function (f) {
    try { var c = pdfContent_(pdfBin_(f.getBlob().getBytes())); return c ? pdfParseClose_(c) : null; } catch (e) { return null; }
  };
  var out = { daily: null, shifts: [] };
  try {
    var it = DriveApp.getFolderById(CLOSE_PDF_FOLDER_).searchFiles("title contains 'dailyclose_" + dateStr + "'"), dailyFiles = [], shiftFiles = [];
    while (it.hasNext()) dailyFiles.push(it.next());
    var si = DriveApp.getFolderById(CLOSE_SHIFT_FOLDER_).searchFiles("title contains '_" + dateStr + "_'");
    while (si.hasNext()) shiftFiles.push(si.next());
    var signature = function (f) { return f.getId() + ':' + f.getLastUpdated().getTime() + ':' + f.getSize(); };
    var sourceVersion = dailyFiles.concat(shiftFiles).map(signature).sort().join('|');
    var cached = P.getProperty(key);
    if (cached) { try { var saved = JSON.parse(cached); if (saved.sourceVersion === sourceVersion) return saved; } catch (e0) {} }
    out.sourceVersion = sourceVersion;
    dailyFiles.sort(function (a, b) { return b.getLastUpdated().getTime() - a.getLastUpdated().getTime(); });
    if (dailyFiles.length) {
      var f = dailyFiles[0], r = read(f);
      if (r && r.found >= 6) out.daily = { rows: r.rows, closed_at: r.closed_at || '', url: f.getUrl() };
    }
    for (var i = 0; i < shiftFiles.length; i++) {
      var sf = shiftFiles[i], mm = /shiftid_(\d+)_userid_(\d+)_/.exec(sf.getName()), sr = read(sf);
      if (mm && sr && sr.found >= 5) out.shifts.push({ no: parseInt(mm[1], 10), user: mm[2], rows: sr.rows, closed_at: sr.closed_at || '', url: sf.getUrl() });
    }
    out.shifts.sort(function (a, b) { return a.no - b.no; });
  } catch (e) { out.error = String(e.message || e).slice(0, 120); return out; }
  if (out.daily) {
    try {
      P.setProperty(key, JSON.stringify(out));
      var cut = Utilities.formatDate(new Date(Date.now() - 60 * 86400000), 'Africa/Cairo', 'yyyy-MM-dd');
      P.getKeys().forEach(function (k) { if ((k.indexOf('CLP_') === 0 && k.slice(4) < cut) || (k.indexOf('CLP2_') === 0 && k.slice(5) < cut)) P.deleteProperty(k); });
    } catch (e2) {}
  }
  return out;
}
/* مطابقة أرقام الفواتير بأرقام نظام البيع في الـ PDF */
function closingChecks_(x, pdf) {
  var R = pdf && pdf.daily && pdf.daily.rows; if (!R) return null;
  var chk = [];
  var add = function (label, p, mine) {
    if (p === undefined || p === null) return;
    chk.push({ label: label, pdf: p, mine: mine, diff: Math.round((mine - p) * 100) / 100 });
  };
  add('كاش المبيعات (بعد المرتجعات)', R.sales_cash && R.sales_cash.sys, x.cash_net);
  add('كارت بنكي', R.bank_card && R.bank_card.sys, x.card);
  add('آجل (الديون)', R.debts && R.debts.v, x.credit);
  add('مرتجعات', R.returns && R.returns.v, x.ret);
  // ملف الديون النصي لا يسجل وسيلة السداد؛ لا نقارنه بتحصيل الكاش.
  return chk;
}

