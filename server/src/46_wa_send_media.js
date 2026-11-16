/* NOVA Rx → عميل واتساب: إرسال صورة (JPEG/PNG) من شاشة المحادثة في NOVA. بيتنادى بس من novaWaBridge_ (op=sendMedia) بعد التحقق من التوكن.
   بيرفع الصورة لميتا (/media) وبعدين يبعتها رسالة image. أي فشل = {ok:false,error} بنص آمن (من غير توكن ولا روابط). مفيش إرسال لو أي فحص فشل. */
var WA_SEND_MEDIA_TYPES_ = { 'image/jpeg': 1, 'image/png': 1 };
var WA_SEND_MEDIA_MAX_ = 5 * 1024 * 1024;
var NOVA_WA_OUT_BYTES_ = null; /* بايتات الصورة الصادرة لحد ما novaWaForwardOut_ تبعتها لـ NOVA، وبتتصفّر دايمًا بعد الإرسال */
function waSendMediaMagicOk_(bytes, mime) {
  var a = bytes[0] & 255, b = bytes[1] & 255, c = bytes[2] & 255, d = bytes[3] & 255;
  if (mime === 'image/jpeg') return a === 0xFF && b === 0xD8 && c === 0xFF;
  if (mime === 'image/png') return a === 0x89 && b === 0x50 && c === 0x4E && d === 0x47;
  return false;
}
function waSendMedia_(chatId, d) {
  d = d || {};
  if (String(d.kind || '') !== 'image') return { ok: false, error: 'unsupported media kind' };
  var mime = String(d.mime || '').toLowerCase();
  if (!WA_SEND_MEDIA_TYPES_[mime]) return { ok: false, error: 'unsupported file type' };
  var caption = String(d.caption == null ? '' : d.caption).trim();
  if (caption.length > 1024) return { ok: false, error: 'caption too long' };
  var b64 = String(d.media_base64 || '');
  if (!b64 || !/^[A-Za-z0-9+\/]+={0,2}$/.test(b64) || b64.length % 4 === 1) return { ok: false, error: 'invalid media' };
  if (Math.floor(b64.length * 3 / 4) > WA_SEND_MEDIA_MAX_ + 3) return { ok: false, error: 'media too large' };
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (eD) { return { ok: false, error: 'invalid media' }; }
  if (!bytes || bytes.length < 8) return { ok: false, error: 'invalid media' };
  if (!waSendMediaMagicOk_(bytes, mime)) return { ok: false, error: 'invalid media' };
  if (bytes.length > WA_SEND_MEDIA_MAX_) return { ok: false, error: 'media too large' };
  var tok = waToken_();
  if (!tok) return { ok: false, error: 'WA_TOKEN missing' };
  var pid = waPhoneId_(), mediaId = '';
  try {
    var up = UrlFetchApp.fetch(WA_API + pid + '/media', { method: 'post', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tok },
      payload: { messaging_product: 'whatsapp', type: mime, file: Utilities.newBlob(bytes, mime, mime === 'image/png' ? 'photo.png' : 'photo.jpg') } });
    var ud = {}; try { ud = JSON.parse(up.getContentText()); } catch (eP) {}
    if (up.getResponseCode() !== 200 || !ud.id) return { ok: false, error: 'upload failed: ' + novaWaSafeErr_((ud.error && ud.error.message) || ('HTTP ' + up.getResponseCode())) };
    mediaId = String(ud.id);
  } catch (e) { return { ok: false, error: 'upload failed: ' + novaWaSafeErr_(e) }; }
  var body = { messaging_product: 'whatsapp', type: 'image', image: caption ? { id: mediaId, caption: caption } : { id: mediaId } };
  var tgt = waTarget_(chatId); for (var k in tgt) body[k] = tgt[k];
  var r;
  NOVA_WA_OUT_BYTES_ = { id: mediaId, mime: mime, b64: b64, size: bytes.length };
  try { r = waCall_(pid + '/messages', body); } finally { NOVA_WA_OUT_BYTES_ = null; }
  if (!r || !r.ok) return { ok: false, error: novaWaSafeErr_((r && r.description) || 'send failed') };
  try { saveConversationTurn(chatId, '[سؤال محوّل للدكتور]', '[صورة]' + (caption ? ' ' + caption : ''), 'pharm'); clearHandoff_(chatId); } catch (eS) {}
  return { ok: true, message_id: (r.result && r.result.message_id) || '' };
}
