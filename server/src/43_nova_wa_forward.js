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
    UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + tok }, payload: JSON.stringify({ source: 'pharmacy-bot', v: 1, messages: [msg] }) });
  } catch (e) { try { Logger.log('novaWaForward_: ' + e.message); } catch (e2) {} }
}
/* رسالة واردة من ميتا (شكل webhook) */
function novaWaForwardIn_(m, pname, phoneNumberId) {
  try {
    var t = m.type || 'text', media = (m && m[t]) || {};
    var text = t === 'text' ? (m.text && m.text.body) : t === 'button' ? (m.button && m.button.text)
      : t === 'interactive' ? ((m.interactive && (m.interactive.button_reply || m.interactive.list_reply) || {}).title) : (media.caption || null);
    novaWaForward_({ id: m.id, from: waSenderId_(m), timestamp: m.timestamp, type: t, text: text || null,
      media_id: media.id || null, filename: media.filename || null, name: pname || null, phone_number_id: phoneNumberId || null, direction: 'in' });
  } catch (e) { try { Logger.log('novaWaForwardIn_: ' + e.message); } catch (e2) {} }
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
