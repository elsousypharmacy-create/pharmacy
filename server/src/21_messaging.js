// ==== MODULE 21_messaging (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 1) استقبال رسايل تليجرام — Webhook أو Polling
// ===================================================================

// بيتنادى من doPost لما تليجرام يبعت update (الوضع السريع)

/* ═══════════════════ 🟢 واتساب (WhatsApp Cloud API) ═══════════════════
   نفس البوت بالظبط: رسالة الواتساب بتتحوّل لشكل رسالة تليجرام وتدخل نفس المعالج،
   وأي رد رايح لشات بيبدأ بـ wa_ بيتبعت على الواتساب بدل تليجرام.
   الإعدادات في Script Properties: WA_TOKEN (التوكن — محدش يشوفه) · WA_PHONE_ID (اختياري). */
var WA_API = 'https://graph.facebook.com/v21.0/';
function waPhoneId_() { return aiKey_('WA_PHONE_ID') || '1321594684378624'; }
function waToken_() { return aiKey_('WA_TOKEN'); }
function isWa_(id) { return String(id || '').indexOf('wa_') === 0; }
/* ميتا بتشيل from (رقم الموبايل) لأصحاب اليوزرنيم وبتبعت from_user_id (BSUID زي US.1349...) بدله.
   معرّف العميل = الرقم لو موجود، وإلا الـ BSUID. */
/* بنرفض القيم الفاضية والنصوص undefined/null عشان منعملش شات wa_undefined */
function waCleanId_(v) {
  if (v && typeof v === 'object') v = v.wa_id || v.user_id || v.id || '';
  var s = String(v == null ? '' : v).trim();
  if (!s || s === 'undefined' || s === 'null' || s === 'NaN') return '';
  if (s.indexOf('wa_') === 0) s = s.slice(3);
  if (!s || s === 'undefined' || s === 'null' || s === 'NaN') return '';
  if (s.charAt(0) === '+') s = s.slice(1);
  var digits = s.replace(/[\s\-()]/g, '');
  if (/^\d{6,20}$/.test(digits)) return digits;
  return s;
}
function badChatId_(chatId) {
  var s = String(chatId == null ? '' : chatId).trim();
  if (!s || s === 'undefined' || s === 'null' || s === 'NaN') return true;
  return /^wa_([_.\-]*|undefined|null|NaN)$/.test(s);
}
function noteBadChatId_(where, chatId, extra) {
  try {
    PropertiesService.getScriptProperties().setProperty('WA_LAST_ERR',
      Utilities.formatDate(new Date(), 'Africa/Cairo', 'MM-dd HH:mm') + ' ' + where +
      ' chat=' + String(chatId) + ' ' + String(extra || '').slice(0, 280));
  } catch (e) {}
}
/* ميتا بتبعّت الرقم أو BSUID في حقول مختلفة حسب نوع الحساب */
function waSenderId_(m) {
  if (!m) return '';
  var cands = [m.from, m.from_user_id, m.user_id, m.sender, m.from_parent_user_id,
    m.identity && (m.identity.user_id || m.identity.id),
    m.context && (m.context.from_user_id || m.context.from)];
  for (var i = 0; i < cands.length; i++) {
    var id = waCleanId_(cands[i]);
    if (id) return id;
  }
  return '';
}
function waIsPhoneId_(id) { return /^\d{6,20}$/.test(String(id || '')); }
/* رقم → to ، BSUID → recipient */
function waTarget_(chatId) {
  var id = String(chatId).slice(3);
  return waIsPhoneId_(id) ? { to: id } : { recipient_type: 'individual', recipient: id };
}
function waChatLabel_(chatId) {
  var id = String(chatId).slice(3);
  return waIsPhoneId_(id) ? '+' + id : 'يوزرنيم واتساب (من غير رقم)';
}
function waVerifyToken_() {
  var P = PropertiesService.getScriptProperties(), v = P.getProperty('WA_VERIFY');
  if (!v) { v = 'elsousy2026wa'; P.setProperty('WA_VERIFY', v); }
  return v;
}
function waInfo() {   /* للوحة: الحالة + اللي تحطه في Meta */
  return { ok: true, hasToken: !!waToken_(), phoneId: waPhoneId_(), verifyToken: waVerifyToken_(),
           callbackUrl: WEB_APP_URL, relayUrl: aiKey_('TG_RELAY_URL') || '',
           lastIn: aiKey_('WA_LAST_IN') || '', lastErr: aiKey_('WA_LAST_ERR') || '' };
}
/* حفظ التوكن من اللوحة (بالرقم السري) — التوكن بيتكتب بس، عمره ما بيرجع للوحة */
function setWaConfig(d) {
  var P = PropertiesService.getScriptProperties();
  var tok = String(d.token || '').trim(), pid = String(d.phoneId || '').trim();
  if (tok) { if (!/^EAA[\w-]{20,}$/.test(tok)) return { ok: false, error: 'التوكن شكله غلط — لازم يبدأ بـ EAA' }; P.setProperty('WA_TOKEN', tok); }
  if (pid) { if (!/^\d{8,20}$/.test(pid)) return { ok: false, error: 'Phone number ID أرقام بس' }; P.setProperty('WA_PHONE_ID', pid); }
  P.deleteProperty('WA_LAST_ERR');
  return { ok: true };
}
/* ربط حساب الواتساب (WABA) بالتطبيق عشان ميتا تبعت الرسايل للويبهوك + فحص */
function waSubscribe() {
  var tok = waToken_(); if (!tok) return { ok: false, error: 'التوكن مش متحط' };
  var waba = aiKey_('WA_WABA_ID') || '1121417500291242', H = { Authorization: 'Bearer ' + tok };
  var r = UrlFetchApp.fetch(WA_API + waba + '/subscribed_apps', { method: 'post', headers: H, muteHttpExceptions: true });
  var g = UrlFetchApp.fetch(WA_API + waba + '/subscribed_apps', { headers: H, muteHttpExceptions: true });
  var ok = r.getResponseCode() === 200, list = [];
  try { list = (JSON.parse(g.getContentText()).data || []).map(function (a) { return (a.whatsapp_business_api_data && a.whatsapp_business_api_data.name) || a.name || '?'; }); } catch (e) {}
  return { ok: ok, apps: list, error: ok ? '' : r.getContentText().slice(0, 300) };
}
function waCall_(path, body) {
  var tok = waToken_();
  if (!tok) return { ok: false, description: 'WA_TOKEN مش متحط في إعدادات السيرفر' };
  try {
    var r = UrlFetchApp.fetch(WA_API + path, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + tok }, payload: JSON.stringify(body) });
    var d = {}; try { d = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200) {
      var why = (d.error && (d.error.error_user_msg || d.error.message)) || ('HTTP ' + r.getResponseCode());
      if (d.error && d.error.code === 131047) why = 'فات أكتر من 24 ساعة على آخر رسالة من العميل — واتساب مش بيسمح برسالة عادية';
      PropertiesService.getScriptProperties().setProperty('WA_LAST_ERR', Utilities.formatDate(new Date(), 'Africa/Cairo', 'MM-dd HH:mm') + ' ' + why);
      return { ok: false, description: why };
    }
    var mid = (d.messages && d.messages[0] && d.messages[0].id) || '';
    /* رسالة البوت من الـ API — لو ميتا رجّعتها إيكو منسجّلهاش تاني كأنها رد الصيدلي */
    if (mid && body && body.type) { try { CacheService.getScriptCache().put('wamout_' + mid, '1', 21600); } catch (eO) {} }
    return { ok: true, result: { message_id: mid } };
  } catch (e) { return { ok: false, description: e.message }; }
}
/* بيبعت نص (ومعاه أزرار تليجرام بعد تحويلها لأزرار واتساب) */
function waSend_(chatId, text, markup) {
  if (holdBlocksBotSend_(chatId, text)) { Logger.log('hold: منع رد البوت ' + chatId); return { ok: false, description: 'hold' }; }
  var tgt = waTarget_(chatId), body = String(text == null ? '' : text).slice(0, 4000), btns = [], extra = '';
  if (markup && markup.inline_keyboard) markup.inline_keyboard.forEach(function (row) { row.forEach(function (b) {
    if (b.callback_data) btns.push({ id: b.callback_data, title: b.text });
    else if (b.url) extra += '\n' + b.text + ': ' + b.url;
  }); });
  if (markup && markup.keyboard) markup.keyboard.forEach(function (row) { row.forEach(function (b) {
    var tx = typeof b === 'string' ? b : b.text;
    if (b.request_location) extra += '\n📍 لإرسال موقعك: دوس 📎 ← الموقع (Location)';
    else if (!b.request_contact && tx) btns.push({ id: 'kb:' + tx, title: tx });
  }); });
  body = (body + extra).trim() || '.';
  var clean = function (s, n) { return String(s).replace(/\s+/g, ' ').trim().slice(0, n); };
  var mk = function (o) { o.messaging_product = 'whatsapp'; Object.keys(tgt).forEach(function (k) { o[k] = tgt[k]; }); return o; };
  if (btns.length && btns.length <= 3)
    return waCall_(waPhoneId_() + '/messages', mk({ type: 'interactive',
      interactive: { type: 'button', body: { text: body.slice(0, 1024) },
        action: { buttons: btns.map(function (b) { return { type: 'reply', reply: { id: String(b.id).slice(0, 256), title: clean(b.title, 20) } }; }) } } }));
  if (btns.length)
    return waCall_(waPhoneId_() + '/messages', mk({ type: 'interactive',
      interactive: { type: 'list', body: { text: body.slice(0, 1024) },
        action: { button: 'اختار من هنا', sections: [{ title: 'الاختيارات', rows: btns.slice(0, 10).map(function (b) { return { id: String(b.id).slice(0, 200), title: clean(b.title, 24) }; }) }] } } }));
  return waCall_(waPhoneId_() + '/messages', mk({ type: 'text', text: { body: body, preview_url: true } }));
}
/* "بيكتب..." + علامة القراية على آخر رسالة من العميل */
function waTyping_(chatId) {
  var mid = CacheService.getScriptCache().get('walast_' + chatId);
  if (mid) waCall_(waPhoneId_() + '/messages', { messaging_product: 'whatsapp', status: 'read', message_id: mid, typing_indicator: { type: 'text' } });
}
/* تحميل صورة/فويس من واتساب */
function waMediaBlob_(mediaId) {
  var tok = waToken_(); if (!tok) return null;
  try {
    var m = JSON.parse(UrlFetchApp.fetch(WA_API + mediaId, { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true }).getContentText());
    if (!m.url) return null;
    return UrlFetchApp.fetch(m.url, { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true }).getBlob();
  } catch (e) { Logger.log('waMedia: ' + e.message); return null; }
}
/* ملف من تليجرام أو واتساب (file_id بيبدأ بـ wa: لو واتساب) */
function tgFileBlob_(fileId) {
  if (String(fileId).indexOf('wa:') === 0) return waMediaBlob_(String(fileId).slice(3));
  var f = tgApi_('getFile', { file_id: fileId });
  if (!f || !f.ok || !f.result || !f.result.file_path) return null;
  return UrlFetchApp.fetch('https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + f.result.file_path, { muteHttpExceptions: true }).getBlob();
}
/* صورة العميل من واتساب → تتبعتلك على تليجرام (بدل forwardMessage) */
function waForwardToStaff_(chatId, n) {
  var mid = CacheService.getScriptCache().get('wamid_' + chatId + '_' + n); if (!mid) return { ok: false };
  var blob = waMediaBlob_(mid); if (!blob) return { ok: false };
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendPhoto', { method: 'post', muteHttpExceptions: true,
      payload: { chat_id: String(PERSONAL_CHAT), caption: '🟢 صورة من واتساب — ' + (getKnownCustomerName_(chatId) || waChatLabel_(chatId)) + '\n[#c' + chatId + ']', photo: blob.setName('p.jpg') } });
  } catch (e) {}
  return { ok: true };
}
function waSeq_(chatId) {   /* رقم مسلسل لكل رسالة (الألبومات محتاجة أرقام متتالية) */
  var c = CacheService.getScriptCache(), k = 'waseq_' + chatId, n = (parseInt(c.get(k), 10) || 1000) + 1;
  c.put(k, String(n), 21600); return n;
}

function handleWhatsAppWebhook_(data) {
  (data.entry || []).forEach(function (en) { (en.changes || []).forEach(function (ch) {
    var v = ch.value || {};
    /* رد الصيدلي من تطبيق واتساب (تعايش). statuses و message_echoes (رسايل البوت من الـ API) مش هنا — منقراهمش ومش بنرد عليهم. */
    if (ch.field === 'smb_message_echoes') {
      (v.message_echoes || []).forEach(function (m) { try { waEcho_(m); } catch (e) { Logger.log('خطأ إيكو واتساب: ' + e.message); } });
      return;
    }
    var names = {};
    (v.contacts || []).forEach(function (c) {
      var nm = c.profile && (c.profile.name || c.profile.username);
      if (c.wa_id) names[c.wa_id] = nm;
      if (c.user_id) names[c.user_id] = nm;
    });
    (v.messages || []).forEach(function (m) { try { waOne_(m, names[waSenderId_(m)] || names[m.from_user_id] || ''); } catch (e) { Logger.log('خطأ واتساب: ' + e.message); } });
  }); });
}
/* معرّف العميل في الإيكو لازم يطابق شات الرسالة الواردة (رقم من غير +، أو نفس الـ BSUID) */
function waEchoPeer_(mOrRaw) {
  if (mOrRaw && typeof mOrRaw === 'object') {
    var cands = [mOrRaw.to, mOrRaw.to_user_id, mOrRaw.recipient_user_id, mOrRaw.recipient, mOrRaw.to_parent_user_id];
    for (var i = 0; i < cands.length; i++) {
      var id = waCleanId_(cands[i]);
      if (id) return id;
    }
    return '';
  }
  return waCleanId_(mOrRaw);
}
function waEchoCap_(obj) {
  var c = obj && obj.caption ? String(obj.caption).trim() : '';
  return c ? ' ' + c : '';
}
/* نص الإيكو للسجل: النص نفسه، وغير النص اختصار قصير. التعديل بيتردّ على الرسالة الجديدة. */
function waEchoBody_(m) {
  if (!m) return '';
  if (m.type === 'edit') return waEchoBody_(m.edit && m.edit.message);
  if (m.type === 'revoke') return '[اتمسحت]';
  if (m.type === 'text') return String((m.text && m.text.body) || '').trim();
  if (m.type === 'button') return String((m.button && m.button.text) || '').trim() || '[زرار]';
  if (m.type === 'image') return '[صورة]' + waEchoCap_(m.image);
  if (m.type === 'video') return '[فيديو]' + waEchoCap_(m.video);
  if (m.type === 'audio' || m.type === 'voice') return '[صوت]';
  if (m.type === 'document') return '[ملف]' + waEchoCap_(m.document);
  if (m.type === 'sticker') return '[ملصق]';
  if (m.type === 'location') return '[موقع]';
  if (m.type === 'contacts') return '[جهة اتصال]';
  if (m.type === 'interactive') return '[رسالة]';
  if (m.type === 'reaction' || m.type === 'unsupported' || m.type === 'system') return '';
  return '[رسالة]';
}
/* ميديا الرسالة (صورة/صوت/فيديو/ملف/ملصق) كـ JSON صغير للسجل: {k:نوع, id:معرّف ميتا, mime} أو فاضي */
function waMediaOf_(m) {
  if (!m) return '';
  var t = m.type === 'voice' ? 'audio' : m.type, o = m[m.type];
  if (!o || !o.id || ['image', 'audio', 'video', 'document', 'sticker'].indexOf(t) === -1) return '';
  return JSON.stringify({ k: t, id: String(o.id), mime: o.mime_type || '' });
}
/* إيكو تطبيق الواتساب: نسجّله على شات العميل بدور الصيدلي، والبوت ميردّش. */
function waEcho_(m) {
  if (!m) return;
  var cache = CacheService.getScriptCache(), id = String(m.id || '');
  if (id && (cache.get('wamout_' + id) || cache.get('wam_' + id))) return;
  var orig = (m.edit && m.edit.original_message_id) || (m.revoke && m.revoke.original_message_id) || '';
  if (orig && cache.get('wamout_' + orig)) return;       /* تعديل/مسح لرسالة البوت نفسه */
  if (id) cache.put('wam_' + id, '1', 21600);
  var peer = waEchoPeer_(m), body = waEchoBody_(m);
  if (!body) return;
  if (!peer || badChatId_('wa_' + peer)) {
    noteBadChatId_('waEcho', 'wa_' + peer, JSON.stringify(m).slice(0, 300));
    return;
  }
  var chatId = 'wa_' + peer, stamp = m.timestamp ? cairoStamp_(m.timestamp) : '';
  var rows = [['pharm', body, stamp, id, waMediaOf_(m.type === 'edit' ? (m.edit && m.edit.message) : m)]];
  if (holdEcho_(chatId)) rows.push(['sys', 'الصيدلي رد من الواتساب — البوت ساكت ٣٠ دقيقة', stamp]);
  logChatRows_(chatId, rows);
  /* رد الصيدلي من تطبيق الواتساب = الخلاصة اتقفلت، منسيبش تنبيه "مستني رد" */
  clearHandoff_(chatId);
}
function waOne_(m, pname) {
  var cache = CacheService.getScriptCache();
  if (cache.get('wam_' + m.id)) return;                    /* ميتا بتعيد نفس الرسالة أحيانًا */
  if (m.id && cache.get('wamout_' + m.id)) return;         /* رسالة البوت من الـ API — مش عميل ومش هنرد عليها */
  cache.put('wam_' + m.id, '1', 21600);
  var sid = waSenderId_(m), P = PropertiesService.getScriptProperties();
  if (!sid || badChatId_('wa_' + sid)) {   /* مفيش رقم ولا BSUID — منحفظ الشكل عشان نشخّصه، ومنعملش شات اسمه wa_undefined */
    noteBadChatId_('waOne', 'wa_' + sid, JSON.stringify(m).slice(0, 300));
    return;
  }
  var chatId = 'wa_' + sid;
  P.setProperty('WA_LAST_IN', Utilities.formatDate(new Date(), 'Africa/Cairo', 'MM-dd HH:mm') + ' ' + m.type);
  cache.put('walast_' + chatId, m.id, 86400);
  /* سجّل رسالة العميل الأصلية فورًا بوقتها الحقيقي ومعرّفها وميديتها، قبل أي معالجة أو رد. */
  try {
    var rb = m.type === 'interactive'
      ? String(((m.interactive.button_reply || m.interactive.list_reply || {}).title) || '').trim()
      : waEchoBody_(m);
    if (rb) {
      logChatRows_(chatId, [['user', rb, m.timestamp ? cairoStamp_(m.timestamp) : '', m.id, waMediaOf_(m)]]);
      cache.put('rawon_' + chatId, '1', 600);
    }
  } catch (eRaw) { Logger.log('raw log: ' + eRaw.message); }
  /* رقم العميل معروف ومتأكد منه من واتساب نفسه — مفيش "سجّل رقمك".
     لو العميل بيوزرنيم ومفيش رقم (BSUID بس) بنسيب البوت يطلب الرقم بالطريقة العادية. */
  if (waIsPhoneId_(sid) && !P.getProperty('vphone_' + chatId)) {
    var vp = canonicalEgyptPhone_('+' + sid) || ('+' + sid);
    P.setProperty('vphone_' + chatId, vp); saveCustomerPhone_(chatId, vp);
  }
  /* تسلسل الألبوم بس. منستناش قفل السكربت خمس ثواني: التريجر الحي بيمسكه وهو بيقرأ المبيعات.
     لو القفل مش فاضي الرسالة بتكمل وتتسجل — مش بتترمي. */
  var lock = LockService.getScriptLock(), gotSeq = false;
  try { gotSeq = lock.tryLock(250); } catch (eL) {}
  var n = waSeq_(chatId);
  if (gotSeq) { try { lock.releaseLock(); } catch (e) {} }
  var msg = { message_id: n, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: pname || '' } };
  if (m.timestamp) {
    var ts = parseInt(m.timestamp, 10);
    if (ts > 1000000000000) ts = Math.floor(ts / 1000);
    if (ts > 1000000000) msg.date = ts;
  }
  if (m.type === 'text') msg.text = m.text.body;
  else if (m.type === 'button') msg.text = m.button.text;
  else if (m.type === 'interactive') {
    var r = m.interactive.button_reply || m.interactive.list_reply || {};
    if (String(r.id).indexOf('kb:') === 0) msg.text = String(r.id).slice(3);
    else { handleCallback_({ id: 'wa', data: r.id, from: { id: chatId }, message: { chat: { id: chatId }, message_id: n } }); return; }
  }
  else if (m.type === 'image' || (m.type === 'document' && /^image\//.test(m.document.mime_type || ''))) {
    var md = m.image || m.document;
    cache.put('wamid_' + chatId + '_' + n, md.id, 21600);
    msg.photo = [{ file_id: 'wa:' + md.id }];
    if (md.caption) msg.caption = md.caption;
    /* الصور اللي بتيجي ورا بعض في أقل من 20 ثانية = ألبوم واحد */
    var gk = 'wagrp_' + chatId, g = cache.get(gk) || (chatId + '_' + n);
    cache.put(gk, g, 20); msg.media_group_id = g;
  }
  else if (m.type === 'audio') msg.voice = { file_id: 'wa:' + m.audio.id, mime_type: m.audio.mime_type || 'audio/ogg', duration: 0 };
  else if (m.type === 'location') msg.location = { latitude: m.location.latitude, longitude: m.location.longitude };
  else if (m.type === 'reaction' || m.type === 'unsupported') return;
  else {
    var fileLabel = '[' + (m.type || 'ملف') + ']';
    if (holdOn_(chatId)) {
      try {
        var mediaObj = m[m.type];
        if (mediaObj && mediaObj.id) {
          var fblob = waMediaBlob_(mediaObj.id);
          if (fblob) UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendDocument', {
            method: 'post', muteHttpExceptions: true,
            payload: { chat_id: String(PERSONAL_CHAT), document: fblob.setName('file'),
              caption: fileLabel + '\n[#c' + chatId + ']' } });
        }
      } catch (eFile) {}
      heldSilence_(chatId, fileLabel, msg.date);
      return;
    }
    var fileNote = 'وصلنا 🌿 للأسف مش بنقدر نفتح النوع ده من الملفات — ممكن حضرتك تكتب طلبك أو تبعت صورة؟';
    waSend_(chatId, fileNote);
    saveConversationTurn(chatId, fileLabel, fileNote, 'bot', msg.date);
    return;
  }
  handleCustomerMessage(chatId, msg);
}

function handleTelegramWebhook_(update) {
  try {
    // 🧹 تنظيف تلقائي مرة واحدة بعد كل نسخة جديدة:
    // بيفضّي أي رسايل قديمة متراكمة عند تليجرام عشان البوت ميردش على كلام قديم
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('queueCleared') !== 'yes') {
      props.setProperty('queueCleared', 'yes');
      try {
        if (WEB_APP_URL && WEB_APP_URL.indexOf('/exec') !== -1) {
          UrlFetchApp.fetch(
            'https://api.telegram.org/bot' + BOT_TOKEN +
            '/setWebhook?drop_pending_updates=true&url=' + encodeURIComponent(tgHookUrl_()),
            { muteHttpExceptions: true });
        }
      } catch (e) {}
      return; // الرسالة دي من الطابور القديم — بنسيبها
    }

    routeTelegramUpdate_(update);
  } catch (e) {
    Logger.log('خطأ handleTelegramWebhook_: ' + e.message);
  }
}

// الوضع القديم (تريجر كل دقيقة) — بيفضل شغال كخطة احتياطية
function checkStaffMessages() {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('telegramWebhookOn') === 'yes') return; // الويبهوك شغال، مش محتاجين polling

    const lastUpdateId = parseInt(props.getProperty('lastStaffUpdateId') || '0');
    const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getUpdates?offset=' + (lastUpdateId + 1) + '&timeout=0';
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(response.getContentText());
    if (!data.ok || !data.result || data.result.length === 0) return;

    for (let update of data.result) {
      props.setProperty('lastStaffUpdateId', String(update.update_id));
      routeTelegramUpdate_(update);
    }
  } catch (e) {
    Logger.log('خطأ checkStaffMessages: ' + e.message);
  }
}

// بيوزّع أي update على المكان الصح
function routeTelegramUpdate_(update) {
  if (update && update.callback_query) {
    var cdk = 'tgu_' + update.update_id, cc = CacheService.getScriptCache();
    if (cc.get(cdk)) return;
    cc.put(cdk, '1', 3600);
    var cqc = update.callback_query.message && update.callback_query.message.chat;
    if (cqc && cqc.type === 'private') handleCallback_(update.callback_query);
    return;
  }
  if (!update || !update.message) return;

  // منع معالجة نفس الرسالة مرتين
  const cache = CacheService.getScriptCache();
  const dedupKey = 'tgu_' + update.update_id;
  if (cache.get(dedupKey)) return;
  cache.put(dedupKey, '1', 3600);

  const msg = update.message;
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();

  /* وقف/تشغيل بوت الواتساب من شات الصيدلي، حتى لو الأمر Reply على رسالة عميل */
  if (botToggleCmd_(chatId, text)) return;

  // (أ) رد الدكتور على سؤال عميل — يتبعت للعميل باسم الصيدلية
  if (msg.reply_to_message && chatId === String(PERSONAL_CHAT)) {
    if (relayDoctorReply_(msg)) return;
  }

  // (ب) أوامر الموظفين (نفس القديم بالظبط)
  if (handleStaffCommand_(chatId, text)) return;

  // (ج) رسالة عميل عادية
  if (msg.chat && msg.chat.type === 'private' && chatId !== String(PERSONAL_CHAT)) {
    handleCustomerMessage(chatId, msg);
  }
}

// أوامر الموظفين — اترجعت زي ما هي
function handleStaffCommand_(chatId, text) {
  const props = PropertiesService.getScriptProperties();

  if (text === 'موظفين') {
    sendTelegramStaff(
      '📊 تقرير الموظفين\n' + SEP + '\nاختار الفترة:\n\n' +
      '0️⃣ اليوم\n1️⃣ أمس\n2️⃣ هذا الأسبوع\n3️⃣ هذا الشهر\n4️⃣ فترة محددة',
      chatId
    );
    props.setProperty('waitingStaffReport_' + chatId, 'period');
    return true;
  }

  if (text === 'النواقص' || text === 'طلبيات') {
    sendTelegramStaff('⏳ جاري تجهيز قائمة الطلبيات من النواقص...', chatId);
    sendOrderSuggestion(chatId);
    return true;
  }

  const waiting = props.getProperty('waitingStaffReport_' + chatId);

  if (waiting === 'period') {
    const now = new Date();
    const today = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
    const dateStr = Utilities.formatDate(now, 'Africa/Cairo', 'dd/MM/yyyy');

    if (text === '0') {
      props.deleteProperty('waitingStaffReport_' + chatId);
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      getReportForDate(today, 'اليوم - ' + dateStr, chatId);
    } else if (text === '1') {
      props.deleteProperty('waitingStaffReport_' + chatId);
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yDate = Utilities.formatDate(yesterday, 'Africa/Cairo', 'yyyy-MM-dd');
      const yDateStr = Utilities.formatDate(yesterday, 'Africa/Cairo', 'dd/MM/yyyy');
      getReportForDate(yDate, 'أمس - ' + yDateStr, chatId);
    } else if (text === '2') {
      props.deleteProperty('waitingStaffReport_' + chatId);
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const wDate = Utilities.formatDate(weekAgo, 'Africa/Cairo', 'yyyy-MM-dd');
      getReportForRange(wDate, today, 'الأسبوع حتى ' + dateStr, chatId);
    } else if (text === '3') {
      props.deleteProperty('waitingStaffReport_' + chatId);
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      const firstOfMonth = today.substring(0, 7) + '-01';
      getReportForRange(firstOfMonth, today, 'الشهر حتى ' + dateStr, chatId);
    } else if (text === '4') {
      props.setProperty('waitingStaffReport_' + chatId, 'custom_date');
      sendTelegramStaff('ابعت الفترة بالشكل ده:\n01/06/2026 - 27/06/2026', chatId);
    }
    return true;
  }

  if (waiting === 'custom_date') {
    props.deleteProperty('waitingStaffReport_' + chatId);
    try {
      const parts = text.split('-').map(function(p){ return p.trim(); });
      const fromParts = parts[0].split('/');
      const toParts = parts[1].split('/');
      const fromDate = fromParts[2] + '-' + fromParts[1] + '-' + fromParts[0];
      const toDate = toParts[2] + '-' + toParts[1] + '-' + toParts[0];
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      getReportForRange(fromDate, toDate, parts[0] + ' - ' + parts[1], chatId);
    } catch (e) {
      sendTelegramStaff('⚠️ صيغة غلط - ابعت كده:\n01/06/2026 - 27/06/2026', chatId);
    }
    return true;
  }

  return false;
}