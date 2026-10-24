// ==== MODULE 25_bot_history_ui (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 6) الذاكرة والتعرّف على العميل
// ===================================================================

function getConversationHistory(chatId) {
  try {
    const raw = CacheService.getScriptCache().get('convo_' + chatId);
    if (raw) return JSON.parse(raw);
    const raw2 = PropertiesService.getScriptProperties().getProperty('convo_' + chatId);
    return raw2 ? JSON.parse(raw2) : [];
  } catch (e) { return []; }
}

/* ═══ 💬 سجل محادثات البوت — شيت دائم بتقراه صفحة المحادثات في اللوحة ═══ */
var CHAT_LOG_SHEET = 'محادثات البوت';
function chatLogSheet_() {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID), sh = ss.getSheetByName(CHAT_LOG_SHEET);
  if (!sh) { sh = ss.insertSheet(CHAT_LOG_SHEET); sh.appendRow(['الوقت', 'chat', 'الاسم', 'الموبايل', 'من', 'الرسالة', 'صور']); sh.setFrozenRows(1); }
  /* العمود السابع = ids صور Drive (مفصولة بفاصلة). الشيت القديم كان 6 أعمدة. */
  if (sh.getMaxColumns() < 7) { sh.insertColumnsAfter(sh.getMaxColumns(), 7 - sh.getMaxColumns()); sh.getRange(1, 7).setValue('صور'); }
  return sh;
}
function chatWho_(chatId) {
  var c = CacheService.getScriptCache(), k = 'who_' + chatId, v = c.get(k);
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  var w = { n: '', p: '' };
  try { w.n = getKnownCustomerName_(chatId) || ''; } catch (e) {}
  try { w.p = getVerifiedPhone_(chatId) || getCustomerPhone_(chatId) || ''; } catch (e) {}
  c.put(k, JSON.stringify(w), 3600);
  return w;
}
function cairoStamp_(unix) {
  var d = new Date();
  if (unix) {
    var n = Number(unix);
    if (n > 1000000000000) n = Math.floor(n / 1000);
    if (n > 1000000000 && !isNaN(n)) d = new Date(n * 1000);
  }
  if (isNaN(d.getTime())) d = new Date();
  return Utilities.formatDate(d, 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
}
/* role: user = العميل · bot = البوت · pharm = الصيدلي · sys = ملاحظة (تحويل/مسك)
   r[2] اختياري = وقت الصف. من غيره بنستخدم دلوقتي. */
function logChatRows_(chatId, rows) {
  try {
    if (!rows || !rows.length || String(chatId) === String(PERSONAL_CHAT)) return;
    if (badChatId_(chatId)) { noteBadChatId_('logChat', chatId, rows[0] && rows[0][1]); return; }
    var w = chatWho_(chatId), now = cairoStamp_();
    var pend = '';   /* صور العميل اللي لسه واصلة: تتربط بأول صف للعميل */
    var vals = rows.filter(function (r) { return r[1]; }).map(function (r) {
      var f = '';
      if (r[0] === 'user' && !pend) { pend = takePendingPhotos_(chatId); f = pend; }
      /* الاقتباس يخليه نص. من غيره الشيت أحيانًا بيحوّل yyyy-MM-dd لتاريخ والعرض بيتلخبط. */
      return ["'" + (r[2] || now), String(chatId), w.n, w.p ? "'" + w.p : '', r[0], String(r[1]).slice(0, 4000), f];
    });
    if (!vals.length) return;
    /* قفل المستخدم مش قفل السكربت. قفل السكربت بيمسكه التريجر الحي واللقطة دقايق.
       هنا بس عشان رسالتين في نفس اللحظة متكتبوش على نفس الصف. لو القفل اتأخر بنكتب برضه. */
    var lock = LockService.getUserLock(), got = false;
    try { got = lock.tryLock(8000); } catch (eL) {}
    try {
      var sh = chatLogSheet_();
      sh.getRange(sh.getLastRow() + 1, 1, vals.length, 7).setValues(vals);
    } finally { if (got) { try { lock.releaseLock(); } catch (e2) {} } }
  } catch (e) { Logger.log('خطأ سجل المحادثات: ' + e.message); }
}

/* arrivalUnix = وقت وصول رسالة العميل (ثواني). صف العميل بياخد الوقت ده، وصف البوت وقت الإرسال. */
function saveConversationTurn(chatId, userText, botText, botRole, arrivalUnix) {
  if (badChatId_(chatId)) { noteBadChatId_('saveTurn', chatId, userText); return; }
  var role = botRole || 'bot';
  if (role === 'bot' && botText && !/^\[/.test(String(botText))) botText = sanitizeBotEmoji_(botText);
  var skipUser = /^\[(سؤال محوّل للدكتور|مستني تأكيد الطلب)\]/.test(String(userText || ''));
  var skipBot = /^\[الصيدلي بيرد بنفسه\]/.test(String(botText || ''));
  var now = cairoStamp_(), userT = arrivalUnix ? cairoStamp_(arrivalUnix) : now;
  logChatRows_(chatId, (skipUser ? [] : [['user', userText, userT]]).concat(skipBot ? [] : [[role, botText, now]]));
  try {
    const history = getConversationHistory(chatId);
    history.push({ role: 'user', text: userText });
    history.push({ role: 'bot', text: botText });
    const trimmed = history.slice(-10);
    const json = JSON.stringify(trimmed);
    CacheService.getScriptCache().put('convo_' + chatId, json, 21600);
    PropertiesService.getScriptProperties().setProperty('convo_' + chatId, json);
  } catch (e) { Logger.log('خطأ saveConversationTurn: ' + e.message); }
}

/* sentOk=false يعني الرد ماتبعّتش لأن الصيدلي ماسك الشات. رسالة العميل تتسجل برضه. */
function logDeliveredTurn_(chatId, userText, botText, arrivalUnix, sentOk) {
  saveConversationTurn(chatId, userText, sentOk === false ? '[الصيدلي بيرد بنفسه]' : botText, 'bot', arrivalUnix);
}

function formatHistory(history) {
  if (!history.length) return '';
  return 'المحادثة اللي فاتت مع نفس العميل:\n' +
    history.map(function(h) { return (h.role === 'user' ? 'العميل: ' : 'الصيدلية: ') + h.text; }).join('\n') +
    '\n\n';
}

// ربط رقم التليفون بالشات لما العميل يبعته
function saveCustomerPhone_(chatId, phone) {
  PropertiesService.getScriptProperties().setProperty('phone_' + chatId, phone);
}
function getCustomerPhone_(chatId) {
  return getVerifiedPhone_(chatId) || PropertiesService.getScriptProperties().getProperty('phone_' + chatId) || '';
}
/* الرقم المؤكد: جه من زرار "شارك رقمي" في تيليجرام — ده بس اللي بنعرف بيه العميل */
function getVerifiedPhone_(chatId) {
  return PropertiesService.getScriptProperties().getProperty('vphone_' + chatId) || '';
}
function sendTelegramMarkup_(chatId, text, markup) {
  try {
    if (holdBlocksBotSend_(chatId, text)) { Logger.log('hold: منع رد البوت ' + chatId); return; }
    text = varyEmoji_(chatId, text);
    if (isWa_(chatId)) { waSend_(String(chatId), text, markup); return; }
    UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chatId, text: text, reply_markup: markup }) });
  } catch (e) {}
}
/* مرة كل 24 ساعة لو العميل لسه ما شاركش رقمه */
function maybeAskPhone_(chatId) {
  if (getVerifiedPhone_(chatId)) return;
  var c = CacheService.getScriptCache();
  if (c.get('askph_' + chatId)) return;
  c.put('askph_' + chatId, '1', 21600);
  var P = PropertiesService.getScriptProperties(), k = 'askph_day_' + chatId;
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  if (P.getProperty(k) === today) return;
  P.setProperty(k, today);
  sendTelegramMarkup_(chatId, '📱 سجّل رقم حضرتك بضغطة واحدة عشان نتعرّف على حضرتك ونخدمك أسرع.', KB_SHARE);
}
/* إيموجي رد البوت: واحد بالكتير من ✅ 🌿 📦 💊. من غير وشوش أو قلوب أو ورد. mode=none للطوارئ. */
var BOT_EMOJI_ALLOW_ = { '✅': 1, '🌿': 1, '📦': 1, '💊': 1 };
function sanitizeBotEmoji_(text, mode) {
  var s = String(text == null ? '' : text);
  if (!s) return s;
  try {
    var kept = false;
    s = s.replace(/\p{Extended_Pictographic}/gu, function (ch) {
      if (mode === 'none') return '';
      if (!BOT_EMOJI_ALLOW_[ch]) return '';
      if (kept) return '';
      kept = true;
      return ch;
    });
    s = s.replace(/[\u200D\uFE0F]/g, '');
  } catch (e) { return String(text); }
  return s.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function varyEmoji_(chatId, text) {
  if (!text || String(chatId) === String(PERSONAL_CHAT)) return text;
  if (String(text).indexOf('رد الصيدلي') !== -1 || String(text).indexOf('رد الدكتور') !== -1) return text;
  return sanitizeBotEmoji_(text, 'one');
}
function tgApi_(method, payload) {
  try {
    if (method === 'sendMessage' && payload && holdBlocksBotSend_(payload.chat_id, payload.text)) {
      Logger.log('hold: منع رد البوت ' + payload.chat_id);
      return { ok: false, description: 'hold' };
    }
    if (method === 'sendMessage' && payload && payload.text) payload.text = varyEmoji_(payload.chat_id, payload.text);
    /* 🟢 واتساب */
    if (payload && method === 'forwardMessage' && isWa_(payload.from_chat_id)) return waForwardToStaff_(String(payload.from_chat_id), payload.message_id);
    if (payload && method === 'answerCallbackQuery' && payload.callback_query_id === 'wa') return { ok: true };
    if (payload && isWa_(payload.chat_id)) {
      if (method === 'sendMessage') return waSend_(String(payload.chat_id), payload.text, payload.reply_markup);
      if (method === 'sendChatAction') { waTyping_(String(payload.chat_id)); return { ok: true }; }
      return { ok: true };
    }
    var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload) });
    return JSON.parse(r.getContentText());
  } catch (e) { return null; }
}
var KB_SHARE = { keyboard: [[{ text: '📱 سجّل رقمي', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
var KB_MENU = { inline_keyboard: [
  [{ text: '🔍 أسأل عن دوا وسعره', callback_data: 'm_ask' }, { text: '🛵 أطلب توصيل', callback_data: 'm_del' }],
  [{ text: '👨‍⚕️ أكلم الصيدلي', callback_data: 'm_doc' }, { text: '📱 سجّل رقمي', callback_data: 'm_reg' }]] };

/* "دكتور احمد" → دكتور احمد · "اسلام شكري الفقي" → اسلام  (من غير أستاذ/ة اللي شكلها مش احترافي) */
function honorName_(nm) {
  var w = String(nm || '').replace(/[|.…]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  var titles = ['دكتور','دكتوره','دكتورة','د','الدكتور','الحاج','الحاجه','الحاجة','حاج','حاجه','مهندس','مهندسه','م','استاذ','أستاذ','استاذه','أستاذة','ام','أم','ابو','أبو','المعلم'];
  return titles.indexOf(w[0]) !== -1 && w[1] ? w[0] + ' ' + w[1] : w[0];
}

/* رسالة الترحيب — ثابتة ومنظمة، مش من الموديل */
function sendWelcome_(chatId, prefix, salam) {
  var first = honorName_(getKnownCustomerName_(chatId));
  var t = (prefix ? prefix + '\n\n' : '') + (first
    ? (salam ? 'وعليكم السلام ورحمة الله يا ' + first + ' 🌿\nأقدر أساعدك في إيه؟' : 'أهلًا يا ' + first + ' 🌿\nأقدر أساعدك في إيه؟')
    : (salam ? 'وعليكم السلام ورحمة الله 🌿\nمعاك ' + PHARMACY_NAME + '، أقدر أساعدك في إيه؟' : 'أهلًا بيك في ' + PHARMACY_NAME + ' 🌿\nأقدر أساعدك في إيه؟'));
  var kb = JSON.parse(JSON.stringify(KB_MENU));
  if (getVerifiedPhone_(chatId)) kb.inline_keyboard[1].pop();   /* مسجل خلاص — نشيل زرار التسجيل */
  tgApi_('sendMessage', { chat_id: chatId, text: t, reply_markup: kb });
}

/* عملاء سيستم الدليفري (شيت "الدليفري" ← العملاء) — قراية بس، مش بنعدّل فيه */
var DELIVERY_SHEET_ID = '1165euofZ-LqZPOLTrQfxwc9sw29oplJ5kYdmTSsG1sg';
function deliveryCustomer_(phone) {
  var canon = canonicalEgyptPhone_(phone); if (!canon) return null;
  var ck = 'dcust_' + canon, c = CacheService.getScriptCache(), hit = c.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var out = null;
  try {
    var sh = SpreadsheetApp.openById(DELIVERY_SHEET_ID).getSheetByName('العملاء');
    if (sh && sh.getLastRow() > 1) {
      var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
      var iN = h.indexOf('الاسم'), iP = h.indexOf('التليفون'), iLa = h.indexOf('خط العرض'), iLo = h.indexOf('خط الطول');
      for (var i = v.length - 1; i >= 1; i--) {
        if (canonicalEgyptPhone_(v[i][iP]) !== canon) continue;
        var la = parseFloat(v[i][iLa]), lo = parseFloat(v[i][iLo]);
        if (isNaN(la) || isNaN(lo)) continue;
        out = { name: String(v[i][iN] || ''), lat: la, lng: lo };
        break;
      }
    }
  } catch (e) {}
  if (out) out.place = placeName_(out.lat, out.lng);
  c.put(ck, JSON.stringify(out), 21600);
  return out;
}
/* إحداثيات → "شارع ...، المنطقة" (خدمة جوجل جوه Apps Script) */
function placeName_(lat, lng) {
  try {
    var r = Maps.newGeocoder().setLanguage('ar').reverseGeocode(lat, lng);
    if (r && r.results && r.results.length) {
      var a = r.results[0].formatted_address || '';
      return a.replace(/،?\s*(مصر|Egypt)\s*$/, '').replace(/\d{4,}/g, '').replace(/^\S+\+\S+\s*،?\s*/, '').trim();
    }
  } catch (e) {}
  return '';
}
function mapsLink_(lat, lng) { return 'https://maps.google.com/?q=' + lat + ',' + lng; }

/* حالة التوصيل للعميل (العنوان اللي أكده) */
function delFlow_(chatId, v) {
  var c = CacheService.getScriptCache();
  if (v === undefined) { try { return JSON.parse(c.get('dflow_' + chatId) || 'null'); } catch (e) { return null; } }
  if (v === null) c.remove('dflow_' + chatId); else c.put('dflow_' + chatId, JSON.stringify(v), 7200);
}

/* زرار "أطلب توصيل" */
function startDelivery_(chatId) {
  if (!getVerifiedPhone_(chatId)) {
    tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE,
      text: 'تمام 🛵 عشان نسجّل الطلب باسم حضرتك ونوصّله صح، دوس على زرار "📱 سجّل رقمي" تحت، وبعدها نكمّل على طول.' });
    delFlow_(chatId, { step: 'needPhone' });
    return;
  }
  var dc = deliveryCustomer_(getVerifiedPhone_(chatId));
  if (dc) {
    tgApi_('sendLocation', { chat_id: chatId, latitude: dc.lat, longitude: dc.lng });
    tgApi_('sendMessage', { chat_id: chatId,
      text: 'نوصّلها لحضرتك على عنوانك المسجل عندنا' + (dc.place ? ':\n📍 ' + dc.place : ' (الموقع اللي فوق)') + '؟',
      reply_markup: { inline_keyboard: [[{ text: '✅ أيوه، نفس العنوان', callback_data: 'd_yes' }, { text: '📍 عنوان تاني', callback_data: 'd_new' }]] } });
    delFlow_(chatId, { step: 'confirm', lat: dc.lat, lng: dc.lng, place: dc.place || '' });
  } else {
    askNewAddress_(chatId);
  }
}
function askNewAddress_(chatId) {
  tgApi_('sendMessage', { chat_id: chatId,
    text: 'ممكن حضرتك تبعت موقعك بزرار "📍 ابعت موقعي" تحت، أو تكتب العنوان بالتفصيل (المنطقة، الشارع، علامة مميزة).',
    reply_markup: { keyboard: [[{ text: '📍 ابعت موقعي', request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
  delFlow_(chatId, { step: 'address' });
}
function addressConfirmed_(chatId, addr) {
  delFlow_(chatId, { step: 'items', address: addr });
  var shown = String(addr || '').replace(/\s*—?\s*https?:\S+/, '').trim();
  tgApi_('sendMessage', { chat_id: chatId, reply_markup: { remove_keyboard: true },
    text: 'تمام، اتسجل العنوان ✅' + (shown ? '\n📍 ' + shown : '') +
          '\nاكتب لحضرتك الأصناف المطلوبة (أو ابعت صورة الروشتة) وأجهزلك الطلب.' });
}

/* الأزرار اللي جوه الرسايل */
function handleCallback_(cq) {
  var chatId = String(cq.message && cq.message.chat && cq.message.chat.id || cq.from.id), d = cq.data || '';
  tgApi_('answerCallbackQuery', { callback_query_id: cq.id });
  /* أزرار الصيدلي: يمسك المحادثة / يرجّع البوت */
  var hm = d.match(/^h_(on|off)_(-?\d+|wa_[\w.]+)$/);
  if (hm) {
    if (chatId !== String(PERSONAL_CHAT)) return;
    var on = hm[1] === 'on';
    holdSet_(hm[2], on);
    try { tgApi_('editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: holdKb_(hm[2], on) }); } catch (e) {}
    sendTelegramStaff(on ? 'البوت ساكت مع العميل ده لمدة ساعتين — أي رسالة منه هتوصلك هنا، اعمل Reply وردّ.'
                         : 'البوت رجع يرد على العميل ده.', PERSONAL_CHAT);
    return;
  }
  /* الصيدلي ماسك المحادثة: زرار العميل ميبعتش رد من البوت ومبيأكدش طلب */
  if (String(chatId) !== String(PERSONAL_CHAT) && holdOn_(chatId)) {
    logChatRows_(chatId, [['user', '[زرار ' + String(d).slice(0, 24) + ']']]);
    return;
  }
  try { tgApi_('editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (e) {}
  if (d === 'o_ok' || d === 'o_edit') {
    if (d === 'o_edit') {
      CacheService.getScriptCache().remove('pord_' + chatId);
      var re = 'تمام. اكتب لحضرتك التعديل (تزوّد أو تشيل صنف أو تغيّر الكمية أو العنوان) وأبعتلك الملخص تاني.';
      tgApi_('sendMessage', { chat_id: chatId, text: re }); saveConversationTurn(chatId, '[ضغط تعديل الطلب]', re); return;
    }
    confirmPendingOrder_(chatId);
    return;
  }
  if (d === 'm_ask') tgApi_('sendMessage', { chat_id: chatId, text: 'اكتب لحضرتك اسم الدوا، وأقولك متوفر ولا لأ وسعره 🔍' });
  else if (d === 'm_del') startDelivery_(chatId);
  else if (d === 'm_doc') {
    escalateToDoctor_(chatId, '[العميل طلب يكلم الصيدلي]', 'طلب التواصل مع الصيدلي');
    tgApi_('sendMessage', { chat_id: chatId, text: 'تمام، بلّغت الصيدلي 👨‍⚕️ اكتب لحضرتك سؤالك هنا وهيرد على حضرتك في أقرب وقت.' });
  }
  else if (d === 'm_reg') tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE, text: 'دوس على زرار "📱 سجّل رقمي" تحت، والتسجيل بيتم بضغطة واحدة 🌸' });
  else if (d === 'd_yes') {
    var f = delFlow_(chatId) || {};
    addressConfirmed_(chatId, (f.place ? f.place + ' — ' : '') + mapsLink_(f.lat, f.lng));
  }
  else if (d === 'd_new') askNewAddress_(chatId);
}

/* آخر عنوان اتسجل للعميل في طلبات البوت */
function lastAddress_(phone) {
  var canon = canonicalEgyptPhone_(phone); if (!canon) return '';
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(ORDERS_SHEET);
    if (!sh || sh.getLastRow() <= 1) return '';
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getDisplayValues();
    for (var i = v.length - 1; i >= 0; i--) if (canonicalEgyptPhone_(v[i][4]) === canon && v[i][5]) return v[i][5];
  } catch (e) {}
  return '';
}

// بيدوّر على اسم العميل في الـ CRM لو رقمه معروف
function getKnownCustomerName_(chatId) {
  try {
    const phone = canonicalEgyptPhone_(getVerifiedPhone_(chatId));
    if (!phone) return '';
    const cached = CacheService.getScriptCache().get('cname_' + phone);
    if (cached) return cached;

    const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
    const sheet = ss.getSheetByName('Customers');
    if (!sheet || sheet.getLastRow() <= 1) return '';
    const map = getHeaderMap(sheet);
    if (map['phone'] === undefined || map['name'] === undefined) return '';
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      if (canonicalEgyptPhone_(data[i][map['phone']]) === phone) {   /* الشيت بيشيل الصفر الأولاني — بنوحّد الشكل */
        const nm = String(data[i][map['name']] || '');
        CacheService.getScriptCache().put('cname_' + phone, nm, 3600);
        return nm;
      }
    }
    return '';
  } catch (e) { return ''; }
}

// بيلقط رقم موبايل مصري من أي رسالة
function extractPhone_(text) {
  const m = String(text || '').replace(/[^\d]/g, ' ').match(/01[0125]\d{8}/);
  return m ? m[0] : '';
}

// ===================================================================
// 7) التسجيل في الشيتات
// ===================================================================

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

// كل صنف طلبه عميل ومكانش موجود — أهم مصدر لقرارات الشراء
function logUnavailableRequest_(chatId, query) {
  try {
    const sheet = getOrCreateSheet_(UNAVAILABLE_SHEET,
      ['التاريخ', 'الوقت', 'الصنف المطلوب', 'رقم الشات', 'تليفون العميل']);
    const now = new Date();
    sheet.appendRow([
      Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd'),
      Utilities.formatDate(now, 'Africa/Cairo', 'HH:mm'),
      query, chatId, getCustomerPhone_(chatId)
    ]);
  } catch (e) { Logger.log('خطأ logUnavailableRequest_: ' + e.message); }
}

// كل سعر البوت قاله لعميل — عشان لو حصلت مشكلة تعرف قال إيه
function logQuote_(chatId, items) {
  try {
    if (!items || !items.length) return;
    const sheet = getOrCreateSheet_(QUOTES_LOG_SHEET,
      ['التاريخ', 'الوقت', 'رقم الشات', 'الصنف', 'السعر المعروض', 'الرصيد وقتها']);
    const now = new Date();
    const d = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
    const t = Utilities.formatDate(now, 'Africa/Cairo', 'HH:mm');
    const rows = items.map(function(it) {
      return [d, t, chatId, it.name, Math.round(it.price), it.stock];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  } catch (e) { Logger.log('خطأ logQuote_: ' + e.message); }
}

// تسجيل أوردر حقيقي + إشعار ليك
function saveOrder_(chatId, itemsText, phone, address, confirmed) {
  if (confirmed !== true) { Logger.log('saveOrder_ من غير تأكيد صريح'); return false; }
  if (badChatId_(chatId)) { noteBadChatId_('saveOrder', chatId, address); return false; }
  if (!phone || !String(itemsText || '').trim()) return false;
  if (!addressComplete_(address).ok) { Logger.log('saveOrder_ عنوان ناقص'); return false; }
  if (!addressInDeliveryArea_(address).ok) { Logger.log('saveOrder_ بره المنطقة'); return false; }
  try {
    const sheet = getOrCreateSheet_(ORDERS_SHEET,
      ['التاريخ', 'الوقت', 'رقم الشات', 'اسم العميل', 'تليفون', 'العنوان', 'الطلب', 'الحالة']);
    const now = new Date();
    const name = getKnownCustomerName_(chatId) || '';
    sheet.appendRow([
      Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd'),
      Utilities.formatDate(now, 'Africa/Cairo', 'HH:mm'),
      chatId, name, phone, address, itemsText, 'جديد'
    ]);
    sendTelegramStaff(
      '🛵 أوردر جديد من الشات\n' + SEP + '\n' +
      (name ? 'العميل: ' + name + '\n' : '') +
      'تليفون: ' + (phone || '—') + '\n' +
      'العنوان: ' + (address || '—') + '\n' +
      'الطلب: ' + itemsText + '\n\n' +
      '(chat: ' + chatId + ')',
      PERSONAL_CHAT
    );
    return true;
  } catch (e) {
    Logger.log('خطأ saveOrder_: ' + e.message);
    return false;
  }
}