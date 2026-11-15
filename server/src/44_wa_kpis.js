// ==== MODULE 44_wa_kpis (WhatsApp KPIs for the owner dashboard; read-only on «محادثات البوت») ====
// Same metric definitions as NOVA Rx UX430 (backend/src/wa-kpis.js). Computed from the existing chat
// log sheet only — this module never writes the sheet, never sends a WhatsApp message, and never
// creates a missing tab. WhatsApp chats only (id starts with wa_).
// BEGIN-KPI-SHARED
var KP_TZ = 'Africa/Cairo';
var KP_DAY = 86400000;
var _kpFmt = null;
function kpTs(v) { var n = Number(v) || 0; return n > 0 && n < 1e12 ? n * 1000 : n; }
function kpParts(t) {
  if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) return kpPartsGas_(t);
  if (!_kpFmt) _kpFmt = new Intl.DateTimeFormat('en-US', { timeZone: KP_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  var o = {};
  _kpFmt.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
  return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday] };
}
function kpPartsGas_(t) {
  var d = new Date(t);
  var stamp = Utilities.formatDate(d, KP_TZ, 'yyyy-MM-dd HH:mm:ss');
  var y = +stamp.slice(0, 4), mo = +stamp.slice(5, 7), day = +stamp.slice(8, 10);
  var h = +stamp.slice(11, 13), mi = +stamp.slice(14, 16), s = +stamp.slice(17, 19);
  var wd = new Date(Date.UTC(y, mo - 1, day, 12)).getUTCDay();
  return { y: y, mo: mo, d: day, h: h, mi: mi, s: s, wd: wd };
}
function kpOffset(t) { var p = kpParts(t); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; }
function kpDayStart(t) { var p = kpParts(t), g = Date.UTC(p.y, p.mo - 1, p.d), s = g - kpOffset(g); return g - kpOffset(s); }
function kpNextDay(t) { return kpDayStart(kpDayStart(t) + 30 * 3600000); }
function kpPrevDay(t) { return kpDayStart(kpDayStart(t) - 12 * 3600000); }
function kpPad(n) { return (n < 10 ? '0' : '') + n; }
function kpDayKey(t) { var p = kpParts(t); return p.y + '-' + kpPad(p.mo) + '-' + kpPad(p.d); }
function kpKeyStart(key) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '')); return m ? kpDayStart(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null; }
function kpDaysBack(now, n) { var s = kpDayStart(now); for (var i = 1; i < n; i++) s = kpPrevDay(s); return s; }
function kpRange(preset, now, fromKey, toKey) {
  var s = kpDayStart(now);
  if (preset === '7d') return { from: kpDaysBack(now, 7), to: kpNextDay(s) };
  if (preset === '30d') return { from: kpDaysBack(now, 30), to: kpNextDay(s) };
  if (preset === 'custom') {
    var a = kpKeyStart(fromKey), b = kpKeyStart(toKey);
    if (a == null && b == null) return { from: s, to: kpNextDay(s) };
    if (a == null) a = b; if (b == null) b = a;
    if (b < a) { var x = a; a = b; b = x; }
    return { from: a, to: kpNextDay(b) };
  }
  return { from: s, to: kpNextDay(s) };
}
function kpIsStaff(k) { return k === 'pharm' || k === 'out'; }
function kpStats(list) {
  var n = list.length;
  if (!n) return { n: 0, avg: null, median: null };
  var a = list.slice().sort(function (x, y) { return x - y; }), sum = 0;
  for (var i = 0; i < n; i++) sum += a[i];
  return { n: n, avg: sum / n, median: n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2 };
}
function kpDur(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return 'أقل من ثانية';
  var s = Math.round(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return d + ' يوم' + (h ? ' ' + h + ' س' : '');
  if (h) return h + ' س' + (m ? ' ' + m + ' د' : '');
  if (m) return m + ' د' + (r ? ' ' + r + ' ث' : '');
  return r + ' ث';
}
function kpCompute(data, o) {
  o = o || {};
  var now = o.now || Date.now(), from = o.from == null ? -Infinity : o.from, to = o.to == null ? Infinity : o.to;
  var names = {}, byC = {}, ids = [];
  (data && data.customers || []).forEach(function (c) { names[c.id] = c.name || c.id; });
  (data && data.events || []).forEach(function (e, i) {
    var t = kpTs(e.t);
    if (!t || !e.c) return;
    if (!byC[e.c]) { byC[e.c] = []; ids.push(e.c); }
    byC[e.c].push({ k: e.k, t: t, m: e.m || null, s: e.s || null, i: i });
  });
  var heat = [], h, w;
  for (w = 0; w < 7; w++) { heat.push([]); for (h = 0; h < 24; h++) heat[w].push(0); }
  var hours = []; for (h = 0; h < 24; h++) hours.push(0);
  var convs = {}, msgs = 0, inN = 0, botN = 0, staffN = 0, firstRt = [], staff = {}, media = { image: 0, audio: 0, video: 0, document: 0, sticker: 0, other: 0 };
  var newC = 0, retC = 0, waiting = [], custs = {};
  ids.forEach(function (c) {
    var ev = byC[c].sort(function (a, b) { return a.t - b.t || a.i - b.i; }), i, e, waitFrom = null, firstIn = null, lastNs = null;
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      if (e.k === 'sys') continue;
      lastNs = e;
      var inR = e.t >= from && e.t < to;
      if (e.k === 'in' && firstIn === null) firstIn = e;
      if (inR) {
        convs[c] = 1; msgs++;
        if (e.m && Object.prototype.hasOwnProperty.call(media, e.m)) media[e.m]++;
        if (e.k === 'in') { inN++; custs[c] = 1; var p = kpParts(e.t); heat[p.wd][p.h]++; hours[p.h]++; }
        else if (e.k === 'bot') botN++;
        else if (kpIsStaff(e.k)) { staffN++; var nm = e.s || ''; staff[nm] = (staff[nm] || 0) + 1; }
      }
      if (e.k === 'in') { if (waitFrom === null) waitFrom = e; }
      else if (kpIsStaff(e.k)) {
        if (waitFrom !== null && waitFrom.t >= from && waitFrom.t < to) firstRt.push(e.t - waitFrom.t);
        waitFrom = null;
      }
    }
    if (custs[c]) { if (firstIn && firstIn.t >= from) newC++; else retC++; }
    if (lastNs && lastNs.k === 'in') {
      var ws = lastNs;
      for (i = ev.length - 1; i >= 0; i--) { if (ev[i].k === 'sys') continue; if (ev[i].k === 'in') ws = ev[i]; else break; }
      var d = Math.max(0, now - ws.t);
      waiting.push({ c: c, name: names[c] || c, t: ws.t, d: d, open: d < KP_DAY });
    }
  });
  waiting.sort(function (a, b) { return (b.open - a.open) || (a.open ? b.d - a.d : a.d - b.d); });
  var staffList = Object.keys(staff).map(function (k) { return { name: k, n: staff[k] }; }).sort(function (a, b) { return b.n - a.n || (a.name < b.name ? -1 : 1); });
  var st = kpStats(firstRt);
  return {
    from: from, to: to, now: now,
    chats: Object.keys(convs).length, msgs: msgs, inMsgs: inN, botMsgs: botN, staffMsgs: staffN,
    firstResponse: { n: st.n, avg: st.avg, median: st.median },
    waitingOpen: waiting.filter(function (x) { return x.open; }).length, waiting: waiting,
    customers: { total: newC + retC, newC: newC, returning: retC },
    staff: staffList, media: media, mediaTotal: media.image + media.audio + media.video + media.document + media.sticker + media.other,
    heat: heat, hours: hours
  };
}
function kpTrend(data, now, n) {
  var start = kpDaysBack(now, n), out = [], idx = {}, cur = start, g = 0;
  while (out.length < n && g++ < 400) { var k = kpDayKey(cur); idx[k] = out.length; out.push({ key: k, chats: 0, msgs: 0, _c: {} }); cur = kpNextDay(cur); }
  var end = kpNextDay(kpDayStart(now));
  (data && data.events || []).forEach(function (e) {
    var t = kpTs(e.t);
    if (!t || e.k === 'sys' || t < start || t >= end) return;
    var j = idx[kpDayKey(t)];
    if (j == null) return;
    out[j].msgs++; if (!out[j]._c[e.c]) { out[j]._c[e.c] = 1; out[j].chats++; }
  });
  return out.map(function (d) { return { key: d.key, chats: d.chats, msgs: d.msgs }; });
}
function kpHeadline(data, now) {
  now = now || Date.now();
  var s = kpDayStart(now), y = kpPrevDay(s), today = kpCompute(data, { from: s, to: kpNextDay(s), now: now }), yd = kpCompute(data, { from: y, to: s, now: now });
  return { today: today, yesterday: yd };
}
// END-KPI-SHARED

var WA_KPI_MEDIA_RE = [
  ['sticker', /^\s*(?:\[(?:ملصق|استيكر|sticker)\]|‎?sticker omitted|‎?تم حذف الملصق|ملصق محذوف)/i],
  ['image', /^\s*(?:\[(?:صورة|صوره|image|photo)\]|‎?image omitted|‎?(?:تم )?حذف الصورة|صورة محذوفة)/i],
  ['audio', /^\s*(?:\[(?:صوت|رسالة صوتية|ريكورد|فويس|audio|voice)\]|‎?audio omitted|‎?(?:تم )?حذف الصوت|صوت محذوف)/i],
  ['video', /^\s*(?:\[(?:فيديو|video)\]|‎?video omitted|‎?(?:تم )?حذف الفيديو|فيديو محذوف)/i],
  ['document', /^\s*(?:\[(?:مستند|ملف|document|file)\]|‎?document omitted|.*\.(?:pdf|docx?|xlsx?)\s*•?\s*\d+\s*(?:صفحة|pages?)\s*‎?(?:document omitted)?)/i]
];
function waKpiMediaKind_(text, photos) {
  if (String(photos || '').trim()) return 'image';
  var s = String(text == null ? '' : text);
  if (!s) return null;
  if (/^\s*<?\s*(?:media omitted|الوسائط محذوفة|تم استبعاد الوسائط)\s*>?\s*$/i.test(s)) return 'other';
  var i;
  for (i = 0; i < WA_KPI_MEDIA_RE.length; i++) if (WA_KPI_MEDIA_RE[i][1].test(s)) return WA_KPI_MEDIA_RE[i][0];
  return null;
}
function waKpiRoleToK_(role) {
  role = String(role || '').trim();
  if (role === 'user' || role === 'in') return 'in';
  if (role === 'bot') return 'bot';
  if (role === 'pharm' || role === 'out') return role;
  if (role === 'sys') return 'sys';
  return '';
}
/* Display values from «محادثات البوت»: الوقت, chat, الاسم, الموبايل, من, الرسالة, صور */
function waKpiParseStamp_(s) {
  s = String(s || '').replace(/^'/, '').trim();
  if (!s) return 0;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    var wall = m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
    if (typeof Utilities !== 'undefined' && Utilities.parseDate) {
      try { return Utilities.parseDate(wall, KP_TZ, 'yyyy-MM-dd HH:mm:ss').getTime(); } catch (e) {}
    }
    /* Node tests: invert Africa/Cairo the same way kpDayStart does. */
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], sec = +(m[6] || 0);
    var guess = Date.UTC(y, mo - 1, d, h, mi, sec);
    var off1 = kpOffset(guess), t1 = guess - off1, off2 = kpOffset(t1);
    return t1 - (off2 - off1);
  }
  var n = Number(s);
  if (n > 0) return kpTs(n);
  return 0;
}
function waKpiDataFromRows_(rows) {
  var names = {}, events = [], i, r, id, k, t;
  (rows || []).forEach(function (r, i) {
    if (!r || !r[1]) return;
    id = String(r[1]);
    if (id.indexOf('wa_') !== 0) return;
    k = waKpiRoleToK_(r[4]);
    if (!k) return;
    t = waKpiParseStamp_(r[0]);
    if (!t) return;
    if (r[2]) names[id] = String(r[2]);
    events.push({ c: id, k: k, t: t, m: waKpiMediaKind_(r[5], r[6]), s: k === 'pharm' || k === 'out' ? 'الصيدلي' : '' });
  });
  return {
    customers: Object.keys(names).concat(events.map(function (e) { return e.c; })).filter(function (id, i, a) { return a.indexOf(id) === i; }).map(function (id) { return { id: id, name: names[id] || id }; }),
    events: events
  };
}
/* Read-only: never create the sheet if it is missing. Caps at the newest 20,000 rows. */
function waKpiLogRows_() {
  try {
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID), sh = ss.getSheetByName(typeof CHAT_LOG_SHEET === 'string' ? CHAT_LOG_SHEET : 'محادثات البوت');
    if (!sh) return [];
    var n = sh.getLastRow() - 1;
    if (n < 1) return [];
    var take = Math.min(n, 20000);
    return sh.getRange(sh.getLastRow() - take + 1, 1, take, 7).getDisplayValues();
  } catch (e) { return []; }
}
function waKpiCompact_(x) {
  return {
    chats: x.chats, msgs: x.msgs, inMsgs: x.inMsgs, botMsgs: x.botMsgs, staffMsgs: x.staffMsgs,
    waitingOpen: x.waitingOpen,
    firstN: x.firstResponse.n, firstAvg: x.firstResponse.avg, firstAvgText: kpDur(x.firstResponse.avg),
    firstMedian: x.firstResponse.median, firstMedianText: kpDur(x.firstResponse.median),
    customers: x.customers, mediaTotal: x.mediaTotal
  };
}
function waKpiLabel_(preset, range, now) {
  if (preset === 'today') return 'النهارده';
  if (preset === '7d') return 'آخر 7 أيام';
  if (preset === '30d') return 'آخر 30 يوم';
  return kpDayKey(range.from) + ' — ' + kpDayKey(range.to - 1);
}
function getWhatsAppKpis(params) {
  params = params || {};
  try {
    var now = Date.now();
    var preset = String(params.preset || params.range || 'today');
    if (preset === 'week') preset = '7d';
    if (preset === 'month' || preset === 'lastMonth') preset = '30d';
    if (preset === 'yesterday') {
      var ys = kpPrevDay(kpDayStart(now));
      params = { preset: 'custom', from: kpDayKey(ys), to: kpDayKey(ys) };
      preset = 'custom';
    }
    var range = kpRange(preset, now, params.from || params.fromKey, params.to || params.toKey);
    var data = waKpiDataFromRows_(waKpiLogRows_());
    var cur = kpCompute(data, { from: range.from, to: range.to, now: now });
    var head = kpHeadline(data, now);
    var trendN = preset === '30d' ? 30 : 7;
    return {
      ok: true, source: 'chat-log-v1', tz: KP_TZ, preset: preset,
      from: kpDayKey(range.from), to: kpDayKey(range.to - 1),
      label: waKpiLabel_(preset, range, now),
      chats: cur.chats, msgs: cur.msgs, inMsgs: cur.inMsgs, botMsgs: cur.botMsgs, staffMsgs: cur.staffMsgs,
      firstResponse: { n: cur.firstResponse.n, avg: cur.firstResponse.avg, median: cur.firstResponse.median, avgText: kpDur(cur.firstResponse.avg), medianText: kpDur(cur.firstResponse.median) },
      waitingOpen: cur.waitingOpen, waiting: cur.waiting.slice(0, 50),
      customers: cur.customers, staff: cur.staff, media: cur.media, mediaTotal: cur.mediaTotal,
      hours: cur.hours, heat: cur.heat, trend: kpTrend(data, now, trendN),
      today: waKpiCompact_(head.today), yesterday: waKpiCompact_(head.yesterday)
    };
  } catch (e) { return { ok: false, error: e.message }; }
}
