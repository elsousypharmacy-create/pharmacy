// ==== MODULE 41_bot_chat_admin (split from server/Code.js; load order = file name order) ====


/* 💬 صفحة المحادثات */
function chatLogRows_(maxRows) {
  var sh = chatLogSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var take = Math.min(n, maxRows || 6000);
  return sh.getRange(sh.getLastRow() - take + 1, 1, take, 7).getDisplayValues();
}
function getBotChats() {
  var rows = chatLogRows_(6000), by = {}, P = PropertiesService.getScriptProperties().getProperties();
  rows.forEach(function (r, i) {
    var id = r[1]; if (!id) return;
    var c = by[id] || (by[id] = { id: id, name: '', phone: '', count: 0, last: '', lastText: '', lastRole: '', ord: -1 });
    if (r[2]) c.name = r[2]; if (r[3]) c.phone = r[3];
    c.count++;
    /* آخر صف اتكتب هو الأحدث. مقارنة نص الوقت بتغلط لو الشيت عارض التاريخ بشكل تاني. */
    if (i >= c.ord) { c.ord = i; c.last = r[0]; c.lastText = String(r[5]).slice(0, 120); c.lastRole = r[4]; }
  });
  var list = Object.keys(by).map(function (id) {
    var c = by[id]; c.pending = P['escp_' + id] || ''; c.hold = holdOn_(id); return c;
  });
  list.sort(function (a, b) { return (b.pending ? 1 : 0) - (a.pending ? 1 : 0) || (b.ord - a.ord); });
  list.forEach(function (c) { delete c.ord; });
  return { ok: true, chats: list.slice(0, 300) };
}
function getBotChat(id) {
  id = String(id || '');
  var msgs = chatLogRows_(8000).filter(function (r) { return r[1] === id; }).slice(-300)
    .map(function (r) { return { t: r[0], role: r[4], text: r[5], f: r[6] || '' }; });
  var w = chatWho_(id);
  return { ok: true, id: id, name: w.n, phone: w.p, hold: holdOn_(id),
           pending: PropertiesService.getScriptProperties().getProperty('escp_' + id) || '', msgs: msgs };
}
function botReply(id, text) {
  id = String(id || ''); text = String(text || '').trim();
  if (!id || !text) return { ok: false, error: 'الرسالة فاضية' };
  var r = tgApi_('sendMessage', { chat_id: id, text: '👨‍⚕️ رد الصيدلي:\n\n' + text });
  if (!r || !r.ok) return { ok: false, error: 'تيليجرام رفض الرسالة' + (r && r.description ? ': ' + r.description : '') };
  saveConversationTurn(id, '[سؤال محوّل للدكتور]', text, 'pharm');
  clearHandoff_(id);
  return { ok: true };
}
function botHold(id, on) {
  holdSet_(String(id), !!on);
  logChatRows_(id, [['sys', on ? '🤫 الصيدلي مسك المحادثة — البوت ساكت' : '▶️ البوت رجع يرد']]);
  return { ok: true, hold: !!on };
}
function botDone(id) {
  clearHandoff_(String(id));
  return { ok: true };
}

/* تذكير للصيدلي لو تحويل عدّى ١٠ دقايق من غير رد. بيشتغل من تريجر كل ١٠ دقايق — متتناداش من الكود.
   BOT_HOURS لو اتقرأت (من 9 لـ 2 بالليل / 9-17) التذكير يسكت بره المواعيد ومبيزودش العدّاد. لو النص مش مفهوم التذكير يكمّل. */
function parseBotHoursWindow_(hours) {
  var raw = String(hours || '');
  var s = normalizeArabic(raw);
  if (!s) return null;
  /* 9:00 رقم واحد (الساعة) مش 9 وبعدين 00 — النقطتين بتتشال في توحيد العربي */
  var re = /(\d{1,2})(?::\d{2})?/g, pos = [], m;
  while ((m = re.exec(raw))) { pos.push({ n: parseInt(m[1], 10), i: m.index }); if (pos.length === 2) break; }
  if (pos.length < 2 || isNaN(pos[0].n) || isNaN(pos[1].n)) return null;
  function night(hour, ctx) {
    if (/(ليل|مسا)/.test(ctx)) {
      if (hour >= 7 && hour <= 11) return hour + 12;
      return hour;
    }
    return hour;
  }
  var a = night(pos[0].n, normalizeArabic(raw.slice(0, pos[1].i)));
  var b = night(pos[1].n, normalizeArabic(raw.slice(pos[1].i)));
  if (a < 0 || a > 23 || b < 0 || b > 23) return null;
  return { start: a, end: b };
}
function withinBotHours_() {
  var hours = '';
  try { hours = botSettings_().hours || ''; } catch (e) { return true; }
  var w = parseBotHoursWindow_(hours);
  if (!w) return true;
  var nowH = 0, nowM = 0;
  try {
    var p = Utilities.formatDate(new Date(), 'Africa/Cairo', 'H:m').split(':');
    nowH = parseInt(p[0], 10); nowM = parseInt(p[1], 10) || 0;
  } catch (e2) { return true; }
  var cur = nowH * 60 + nowM, start = w.start * 60, end = w.end * 60;
  if (end <= start) return cur >= start || cur < end;
  return cur >= start && cur < end;
}
function parseCairoMinute_(s) {
  try { return Utilities.parseDate(String(s || ''), 'Africa/Cairo', 'yyyy-MM-dd HH:mm').getTime(); }
  catch (e) { return 0; }
}
function maskPhone_(phone) {
  var d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  return '…' + d.slice(-3);
}
function maskPhonesInText_(text) {
  return String(text || '').replace(/(?:\+?2)?0?1[0125]\d{8}/g, function (m) {
    var d = m.replace(/\D/g, '');
    return '…' + d.slice(-3);
  });
}
function remindPendingHandoffs() {
  var P = PropertiesService.getScriptProperties(), all = {};
  try { all = P.getProperties() || {}; } catch (e) { return; }
  var now = Date.now(), inHours = withinBotHours_();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('escp_') !== 0) return;
    var chatId = k.slice(5);
    if (!chatId || badChatId_(chatId)) return;
    var since = parseCairoMinute_(all[k]);
    if (!since) return;
    var waitMin = Math.floor((now - since) / 60000);
    if (waitMin < 10) return;
    var meta = {};
    try { meta = JSON.parse(all['escr_' + chatId] || '{}') || {}; } catch (eM) { meta = {}; }
    var n = parseInt(meta.n, 10) || 0;
    if (n >= 6) return;
    if (meta.at && (now - Number(meta.at)) < 9 * 60000) return;
    if (!inHours) return;
    var name = '', phone = '', last = '';
    try { name = getKnownCustomerName_(chatId) || ''; } catch (eN) {}
    try { phone = getVerifiedPhone_(chatId) || getCustomerPhone_(chatId) || ''; } catch (eP) {}
    try {
      var hist = getConversationHistory(chatId) || [];
      for (var i = hist.length - 1; i >= 0; i--) {
        if (hist[i].role === 'user' && hist[i].text && String(hist[i].text).charAt(0) !== '[') {
          last = String(hist[i].text).slice(0, 180);
          break;
        }
      }
    } catch (eH) {}
    sendTelegramStaff('⏰ لسه مستني رد\n' + (name || 'عميل') + (phone ? ' · ' + phone : '') +
      '\nمستني من ' + waitMin + ' دقيقة' + (last ? '\n"' + last + '"' : '') + '\n[#c' + chatId + ']', PERSONAL_CHAT);
    /* نسخة الجروب: آخر ٣ أرقام بس، ومن غير [#c] عشان الرقم متبقاش جوه العلامة والرد من الجروب مش بيتوصّل. */
    if (String(STAFF_GROUP) && String(STAFF_GROUP) !== String(PERSONAL_CHAT)) {
      var masked = maskPhone_(phone);
      var groupLast = maskPhonesInText_(last);
      sendTelegramStaff('⏰ لسه مستني رد\n' + (name || 'عميل') + (masked ? ' · ' + masked : '') +
        '\nمستني من ' + waitMin + ' دقيقة' + (groupLast ? '\n"' + groupLast + '"' : '') +
        '\nالرد على العميل من الشات الخاص، مش من الجروب.', STAFF_GROUP);
    }
    try { P.setProperty('escr_' + chatId, JSON.stringify({ n: n + 1, at: now })); } catch (eS) {}
  });
}
/* تريجرز كانت بتتظبط من المحرر. التنبيه بتاع التحويل بيتظبط لوحده.
   التانيين (ديون / كوبونات) من زرار في الصيانة بس، عشان واحد بيبعت SMS والتاني بيعدّل حالات. */
var EDITOR_TRIGGERS_ = {
  remindPendingHandoffs: {
    label: 'تنبيه التحويل للصيدلي كل ١٠ دقايق',
    auto: true,
    install: function () { ScriptApp.newTrigger('remindPendingHandoffs').timeBased().everyMinutes(10).create(); }
  },
  sendWeeklyDebtReminders: {
    label: 'تذكير الديون كل سبت الساعة ١١',
    auto: false,
    install: function () { ScriptApp.newTrigger('sendWeeklyDebtReminders').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(11).create(); }
  },
  checkExpiredCoupons: {
    label: 'فحص الكوبونات كل يوم الساعة ٩',
    auto: false,
    install: function () { ScriptApp.newTrigger('checkExpiredCoupons').timeBased().atHour(9).everyDays(1).create(); }
  }
};
var TRIGGERS_ENSURED_MARK_ = 'handoff10';
function ensureTriggers_(opts) {
  opts = opts || {};
  var which = String(opts.which || '');
  var names = [];
  if (which) {
    if (!EDITOR_TRIGGERS_[which]) return { ok: false, error: 'التنبيه ده مش معروف' };
    names = [which];
  } else {
    Object.keys(EDITOR_TRIGGERS_).forEach(function (k) { if (EDITOR_TRIGGERS_[k].auto) names.push(k); });
  }
  var have = {};
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var n = t.getHandlerFunction();
      have[n] = (have[n] || 0) + 1;
    });
  } catch (e) {
    return { ok: false, error: 'مقدرتش أقرأ التريجرز. لو جوجل طلب موافقة، اقبلها مرة واحدة — نفس صلاحية التحديث التلقائي واللقطة.', message: String(e.message || e).slice(0, 240) };
  }
  var created = [], existed = [], errors = [];
  names.forEach(function (name) {
    var spec = EDITOR_TRIGGERS_[name];
    if (have[name]) { existed.push(spec.label); return; }
    try { spec.install(); created.push(spec.label); have[name] = 1; }
    catch (e2) { errors.push(spec.label + ': ' + String(e2.message || e2).slice(0, 180)); }
  });
  var msg = errors.length ? ('مقدرتش أفعّل: ' + errors.join(' — '))
    : (created.length ? ('اتفعّل: ' + created.join('، ') + (existed.length ? '. وكان موجود: ' + existed.join('، ') : ''))
       : ('شغالة أصلًا: ' + existed.join('، ')));
  var ok = !errors.length;
  if (ok && (!which || which === 'remindPendingHandoffs')) {
    try { PropertiesService.getScriptProperties().setProperty('TRIGGERS_ENSURED', TRIGGERS_ENSURED_MARK_); } catch (eP) {}
  }
  return { ok: ok, created: created, existed: existed, errors: errors, message: msg, error: errors.length ? msg : '' };
}
function maybeEnsureTriggers_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('TRIGGERS_ENSURED') === TRIGGERS_ENSURED_MARK_) return;
  var failAt = parseInt(P.getProperty('TRIGGERS_ENSURED_FAIL') || '0', 10);
  if (failAt && (Date.now() - failAt) < 6 * 3600000) return;
  var r = ensureTriggers_();
  if (r && r.ok) { try { P.deleteProperty('TRIGGERS_ENSURED_FAIL'); } catch (e) {} }
  else { try { P.setProperty('TRIGGERS_ENSURED_FAIL', String(Date.now())); } catch (e2) {} }
}
function setupHandoffReminderTrigger() {
  var r = ensureTriggers_({ which: 'remindPendingHandoffs' });
  Logger.log(r.message || r.error || '');
  return r;
}

/* ═══ 📷 صور المحادثات: بتتحفظ في فولدر Drive خاص "صور البوت" وبتظهر في اللوحة بالرقم السري بس ═══ */
var BOT_PHOTO_KEEP_DAYS_ = 90;
function photoFolder_() {
  var P = PropertiesService.getScriptProperties(), id = P.getProperty('BOT_PHOTO_FOLDER');
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var it = DriveApp.getFoldersByName('صور البوت'), fo = it.hasNext() ? it.next() : DriveApp.createFolder('صور البوت');
  P.setProperty('BOT_PHOTO_FOLDER', fo.getId());
  return fo;
}
function takePendingPhotos_(chatId) {
  try {
    var c = CacheService.getScriptCache(), k = 'pimg_' + chatId, v = c.get(k);
    if (v) c.remove(k);
    return v || '';
  } catch (e) { return ''; }
}
/* بتتسجّل أول ما صور العميل توصل، لكن الحفظ الفعلي بيحصل في الآخر (flushPhotoSave_) بعد ما الرد يتبعت. */
var PHOTO_SAVE_Q_ = null;
function savePhotosForLog_(chatId, fileIds) { PHOTO_SAVE_Q_ = { chatId: chatId, fileIds: fileIds || [] }; }
function flushPhotoSave_() {
  var q = PHOTO_SAVE_Q_; PHOTO_SAVE_Q_ = null;
  if (!q) return;
  try {
    var ids = savePhotosToDrive_(q.chatId, q.fileIds);
    if (!ids.length) return;
    var lock = LockService.getUserLock(), got = false;
    try { got = lock.tryLock(8000); } catch (eL) {}
    try {
      var sh = chatLogSheet_(), last = sh.getLastRow(), from = Math.max(2, last - 80);
      var vals = sh.getRange(from, 1, last - from + 1, 7).getValues();
      for (var i = vals.length - 1; i >= 0; i--) {
        var r = vals[i];
        if (String(r[1]) === String(q.chatId) && r[4] === 'user' && !r[6]) { sh.getRange(from + i, 7).setValue(ids.join(',')); break; }
      }
    } finally { if (got) { try { lock.releaseLock(); } catch (e2) {} } }
    cleanOldBotPhotos_();
  } catch (e) { Logger.log('flushPhotoSave_: ' + e.message); }
}
function savePhotosToDrive_(chatId, fileIds) {
  var ids = [];
  try {
    var fo = photoFolder_(), stamp = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyyMMdd_HHmmss');
    (fileIds || []).slice(0, 10).forEach(function (fid, i) {
      try {
        var b = tgFileBlob_(fid); if (!b) return;
        ids.push(fo.createFile(b.setName(String(chatId) + '_' + stamp + '_' + (i + 1) + '.jpg')).getId());
      } catch (e1) { Logger.log('savePhoto: ' + e1.message); }
    });
  } catch (e) { Logger.log('savePhotosToDrive_: ' + e.message); }
  return ids;
}
/* مرة في اليوم (وقت ما صورة جديدة توصل): امسح الصور الأقدم من ٩٠ يوم */
function cleanOldBotPhotos_() {
  var P = PropertiesService.getScriptProperties(), today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  if (P.getProperty('BOT_PHOTO_CLEAN') === today) return;
  P.setProperty('BOT_PHOTO_CLEAN', today);
  try {
    var cut = Utilities.formatDate(new Date(Date.now() - BOT_PHOTO_KEEP_DAYS_ * 86400000), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
    var it = photoFolder_().searchFiles("createdDate < '" + cut + "'"), n = 0;
    while (it.hasNext() && n < 200) { it.next().setTrashed(true); n++; }
  } catch (e) { Logger.log('cleanOldBotPhotos_: ' + e.message); }
}
/* بترجّع الصورة كـ data URL. full=false → مصغّرة. بترفض أي ملف مش جوه فولدر الصور. */
function botPhoto(id, full) {
  id = String(id || '').replace(/[^\w-]/g, '');
  if (!id) return { ok: false, error: 'مفيش صورة' };
  try {
    var f = DriveApp.getFileById(id), fo = photoFolder_(), inside = false, ps = f.getParents();
    while (ps.hasNext()) if (ps.next().getId() === fo.getId()) inside = true;
    if (!inside) return { ok: false, error: 'مش من صور البوت' };
    var b = null;
    if (!full) { try { b = f.getThumbnail(); } catch (eT) { b = null; } }
    if (!b) b = f.getBlob();
    return { ok: true, data: 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes()) };
  } catch (e) { return { ok: false, error: 'الصورة اتمسحت أو مش متاحة' }; }
}
