/* NOVA Rx: نسخة من رسايل الواتساب (وارد/صادر) بتتبعت لـ NOVA. مفيش حاجة بتحصل لو NOVA_WA_BRIDGE_URL أو NOVA_WA_BRIDGE_TOKEN (32+) مش متحطين.
   fire-and-forget: عمرها ما بترمي ولا بتعطّل أو بتغيّر رد العميل. */
function novaWaForward_(item) {
  try {
    var P = PropertiesService.getScriptProperties();
    var url = String(P.getProperty('NOVA_WA_BRIDGE_URL') || ''), tok = String(P.getProperty('NOVA_WA_BRIDGE_TOKEN') || '');
    if (!url || tok.length < 32 || !item || !item.id) return;
    var cache = CacheService.getScriptCache(), key = 'novafwd_' + item.id;
    if (cache.get(key)) return;
    cache.put(key, '1', 21600);
    var msg = { id: String(item.id), from: String(item.from || ''), timestamp: String(item.timestamp || Math.floor(Date.now() / 1000)),
      type: item.type || 'text', text: item.text == null ? null : String(item.text), media_id: item.media_id || null,
      filename: item.filename || null, name: item.name || null, phone_number_id: item.phone_number_id || null, direction: item.direction === 'out' ? 'out' : 'in' };
    if (item.mime_type) msg.mime_type = String(item.mime_type);
    if (item.media_size != null && isFinite(Number(item.media_size))) msg.media_size = Number(item.media_size);
    if (item.media_base64) msg.media_base64 = String(item.media_base64);
    if (item.media_skipped) msg.media_skipped = String(item.media_skipped);
    UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + tok }, payload: JSON.stringify({ source: 'pharmacy-bot', v: 1, messages: [msg] }) });
  } catch (e) { try { Logger.log('novaWaForward_: ' + e.message); } catch (e2) {} }
}
/* رسالة واردة من ميتا (شكل webhook) */
var NOVA_WA_MEDIA_MAX_ = 5 * 1024 * 1024; /* 5 MB — الأكبر: ميتاداتا بس */
var NOVA_WA_MEDIA_TYPES_ = { image: 1, sticker: 1, audio: 1, video: 1, document: 1 };
function novaWaSafeErr_(e) {
  var s = String((e && e.message) || e || '');
  s = s.replace(/https?:\/\/[^\s]+/g, '[url]').replace(/EAA[\w-]+/g, '[redacted]').replace(/Bearer\s+\S+/ig, 'Bearer [redacted]');
  return s.slice(0, 200);
}
/* يجيب البايتات من Graph (المفتاح WA_TOKEN موجود هنا بس). عمره ما بيسجّل التوكن ولا رابط التحميل (الرابط فيه توقيع). */
function novaWaAttachMedia_(mediaId) {
  var out = { mime_type: null, media_size: null, media_base64: null, media_skipped: null };
  try {
    var tok = waToken_();
    if (!tok) { out.media_skipped = 'no_token'; return out; }
    var id = String(mediaId || '');
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) { out.media_skipped = 'bad_id'; return out; }
    var metaR = UrlFetchApp.fetch(WA_API + encodeURIComponent(id), {
      method: 'get', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true
    });
    if (metaR.getResponseCode() !== 200) { out.media_skipped = 'fetch_failed'; return out; }
    var meta = {};
    try { meta = JSON.parse(metaR.getContentText()); } catch (eP) { out.media_skipped = 'fetch_failed'; return out; }
    if (meta.mime_type) out.mime_type = String(meta.mime_type);
    if (meta.file_size != null && isFinite(Number(meta.file_size))) out.media_size = Number(meta.file_size);
    if (out.media_size && out.media_size > NOVA_WA_MEDIA_MAX_) { out.media_skipped = 'too_large'; return out; }
    var url = meta.url;
    if (!url || typeof url !== 'string' || url.indexOf('https://') !== 0) { out.media_skipped = 'no_url'; return out; }
    var binR = UrlFetchApp.fetch(url, {
      method: 'get', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true
    });
    if (binR.getResponseCode() !== 200) { out.media_skipped = 'fetch_failed'; return out; }
    var bytes = binR.getBlob().getBytes();
    var n = bytes.length;
    out.media_size = n;
    if (n > NOVA_WA_MEDIA_MAX_) { out.media_skipped = 'too_large'; return out; }
    if (!out.mime_type) {
      try { out.mime_type = binR.getBlob().getContentType() || null; } catch (eT) {}
    }
    out.media_base64 = Utilities.base64Encode(bytes);
    return out;
  } catch (e) {
    try { Logger.log('novaWaAttachMedia_: ' + novaWaSafeErr_(e)); } catch (e2) {}
    out.media_base64 = null;
    out.media_skipped = out.media_skipped || 'fetch_failed';
    return out;
  }
}
function novaWaForwardIn_(m, pname, phoneNumberId) {
  try {
    var t = m.type || 'text', media = (m && m[t]) || {};
    var text = t === 'text' ? (m.text && m.text.body) : t === 'button' ? (m.button && m.button.text)
      : t === 'interactive' ? ((m.interactive && (m.interactive.button_reply || m.interactive.list_reply) || {}).title) : (media.caption || null);
    var item = { id: m.id, from: waSenderId_(m), timestamp: m.timestamp, type: t, text: text || null,
      media_id: media.id || null, filename: media.filename || null, name: pname || null, phone_number_id: phoneNumberId || null, direction: 'in' };
    if (media.mime_type) item.mime_type = media.mime_type;
    if (media.id && NOVA_WA_MEDIA_TYPES_[t]) {
      try {
        var att = novaWaAttachMedia_(media.id);
        if (att.mime_type) item.mime_type = att.mime_type;
        if (att.media_size != null) item.media_size = att.media_size;
        if (att.media_base64) item.media_base64 = att.media_base64;
        else if (att.media_skipped) item.media_skipped = att.media_skipped;
      } catch (eM) {
        item.media_skipped = 'fetch_failed';
        try { Logger.log('novaWaForwardIn_ media: ' + novaWaSafeErr_(eM)); } catch (e2) {}
      }
    }
    novaWaForward_(item);
  } catch (e) { try { Logger.log('novaWaForwardIn_: ' + novaWaSafeErr_(e)); } catch (e2) {} }
}
/* رد البوت الصادر بعد نجاحه (من waCall_) */
function novaWaForwardOut_(body, mid, path) {
  try {
    var t = body.type || 'text', media = body[t] || {};
    var text = t === 'text' ? (body.text && body.text.body) : t === 'interactive' ? (body.interactive && body.interactive.body && body.interactive.body.text) : (media.caption || null);
    novaWaForward_({ id: mid, from: String(body.to || body.recipient || '').replace(/\D/g, ''), type: t, text: text || null,
      media_id: media.id || null, filename: media.filename || null, phone_number_id: String(path || '').split('/')[0] || null, direction: 'out' });
  } catch (e) { try { Logger.log('novaWaForwardOut_: ' + e.message); } catch (e2) {} }
}
/* مفتاح الرد التلقائي: BOT_AUTO_REPLY='0' = مقفول. أي حاجة تانية/مش موجود = شغال. كاش 30 ثانية. */
function botAutoReplyOff_() {
  try {
    var c = CacheService.getScriptCache(), hit = c.get('bot_autoreply');
    if (hit === '1' || hit === '0') return hit === '0';
    var off = PropertiesService.getScriptProperties().getProperty('BOT_AUTO_REPLY') === '0';
    try { c.put('bot_autoreply', off ? '0' : '1', 30); } catch (eP) {}
    return off;
  } catch (e) { return false; }
}
function botAutoReplySet_(on) {
  PropertiesService.getScriptProperties().setProperty('BOT_AUTO_REPLY', on ? '1' : '0');
  try { CacheService.getScriptCache().remove('bot_autoreply'); } catch (e) {}
}
