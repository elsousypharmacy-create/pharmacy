/* NOVA Rx → عميل واتساب: إرسال صورة (JPEG/PNG) من شاشة المحادثة في NOVA. بيتنادى بس من novaWaBridge_ (op=sendMedia) بعد التحقق من التوكن.
   بيرفع الصورة لميتا (/media) وبعدين يبعتها رسالة image. أي فشل = {ok:false,error} بنص آمن (من غير توكن ولا روابط). مفيش إرسال لو أي فحص فشل. */
/* kind -> allowed types. صوت: صيغ واتساب بس (webm اللي كروم بيسجّله مش مدعوم عندهم). */
var WA_SEND_MEDIA_KINDS_ = { image: { 'image/jpeg': 1, 'image/png': 1 }, audio: { 'audio/ogg': 1, 'audio/mp4': 1, 'audio/mpeg': 1, 'audio/aac': 1, 'audio/amr': 1 } };
var WA_SEND_MEDIA_MAX_ = 5 * 1024 * 1024;
var NOVA_WA_OUT_BYTES_ = null; /* بايتات الصورة الصادرة لحد ما novaWaForwardOut_ تبعتها لـ NOVA، وبتتصفّر دايمًا بعد الإرسال */
function waSendMediaMagicOk_(bytes, mime) {
  var a = bytes[0] & 255, b = bytes[1] & 255, c = bytes[2] & 255, d = bytes[3] & 255;
  if (mime === 'image/jpeg') return a === 0xFF && b === 0xD8 && c === 0xFF;
  if (mime === 'image/png') return a === 0x89 && b === 0x50 && c === 0x4E && d === 0x47;
  if (mime === 'audio/ogg') return a === 0x4F && b === 0x67 && c === 0x67 && d === 0x53; /* OggS */
  if (mime === 'audio/mp4') return (bytes[4] & 255) === 0x66 && (bytes[5] & 255) === 0x74 && (bytes[6] & 255) === 0x79 && (bytes[7] & 255) === 0x70; /* ....ftyp */
  if (mime === 'audio/mpeg') return (a === 0x49 && b === 0x44 && c === 0x33) || (a === 0xFF && (b & 0xE0) === 0xE0); /* ID3 أو frame sync */
  if (mime === 'audio/aac') return a === 0xFF && (b & 0xF6) === 0xF0; /* ADTS */
  if (mime === 'audio/amr') return a === 0x23 && b === 0x21 && c === 0x41 && d === 0x4D && (bytes[4] & 255) === 0x52; /* #!AMR */
  return false;
}
var WA_SEND_MEDIA_EXT_ = { 'image/jpeg': 'photo.jpg', 'image/png': 'photo.png', 'audio/ogg': 'voice.ogg', 'audio/mp4': 'voice.m4a', 'audio/mpeg': 'voice.mp3', 'audio/aac': 'voice.aac', 'audio/amr': 'voice.amr' };
function waSendMedia_(chatId, d) {
  d = d || {};
  var kind = String(d.kind || '');
  if (!WA_SEND_MEDIA_KINDS_.hasOwnProperty(kind)) return { ok: false, error: 'unsupported media kind' };
  var mime = String(d.mime || '').toLowerCase();
  if (!WA_SEND_MEDIA_KINDS_[kind].hasOwnProperty(mime)) return { ok: false, error: 'unsupported file type' };
  var caption = String(d.caption == null ? '' : d.caption).trim();
  if (kind === 'audio' && caption) return { ok: false, error: 'caption not allowed' };
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
      payload: { messaging_product: 'whatsapp', type: mime, file: Utilities.newBlob(bytes, mime, WA_SEND_MEDIA_EXT_[mime]) } });
    var ud = {}; try { ud = JSON.parse(up.getContentText()); } catch (eP) {}
    if (up.getResponseCode() !== 200 || !ud.id) return { ok: false, error: 'upload failed: ' + novaWaSafeErr_((ud.error && ud.error.message) || ('HTTP ' + up.getResponseCode())) };
    mediaId = String(ud.id);
  } catch (e) { return { ok: false, error: 'upload failed: ' + novaWaSafeErr_(e) }; }
  var body = { messaging_product: 'whatsapp', type: kind }; body[kind] = caption ? { id: mediaId, caption: caption } : { id: mediaId };
  var tgt = waTarget_(chatId); for (var k in tgt) body[k] = tgt[k];
  var r;
  NOVA_WA_OUT_BYTES_ = { id: mediaId, mime: mime, b64: b64, size: bytes.length };
  try { r = waCall_(pid + '/messages', body); } finally { NOVA_WA_OUT_BYTES_ = null; }
  if (!r || !r.ok) return { ok: false, error: novaWaSafeErr_((r && r.description) || 'send failed') };
  try { saveConversationTurn(chatId, '[سؤال محوّل للدكتور]', kind === 'audio' ? '[رسالة صوتية]' : '[صورة]' + (caption ? ' ' + caption : ''), 'pharm'); clearHandoff_(chatId); } catch (eS) {}
  return { ok: true, message_id: (r.result && r.result.message_id) || '' };
}
