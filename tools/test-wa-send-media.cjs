// Sending a photo from NOVA to a WhatsApp customer through the bridge (Meta API stubbed; nothing real is sent).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const grab = (file, name) => { const src = read(file); const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name + ' in ' + file); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } throw new Error('unbalanced ' + name); };

const TOKEN = 'b'.repeat(40);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF fake jpeg bytes')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake png bytes')]);
const b64 = (b) => b.toString('base64');

function make(opts = {}) {
  const fetches = [], log = [], P = Object.assign({ NOVA_WA_BRIDGE_TOKEN: TOKEN, NOVA_WA_BRIDGE_URL: 'https://nova.example/api/v1/webhooks/whatsapp-bridge', WA_TOKEN: 'EAAtesttesttesttesttesttest', WA_PHONE_ID: '111222333' }, opts.props || {});
  const cache = {};
  const ctx = vm.createContext({
    String, Number, Object, Array, JSON, Math, RegExp, parseInt, isNaN, Error, Date, Buffer,
    Logger: { log: (x) => log.push(String(x)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in P ? P[k] : null), setProperty: (k, v) => { P[k] = String(v); }, deleteProperty: (k) => { delete P[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); } }) },
    Utilities: {
      base64Decode: (s) => { const b = Buffer.from(String(s), 'base64'); return Array.from(b).map((x) => (x > 127 ? x - 256 : x)); },
      newBlob: (bytes, mime, name) => ({ _bytes: bytes, _mime: mime, _name: name }),
      formatDate: () => '11-16 10:00', sleep() {},
    },
    UrlFetchApp: { fetch(u, o) {
      fetches.push({ u, o });
      if (/\/media$/.test(u)) { if (opts.uploadFail) return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: { message: 'bad media' } }) }; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: 'MEDIA123' }) }; }
      if (/\/messages$/.test(u)) { if (opts.sendFail) return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: { code: opts.sendFail, message: 'closed' } }) }; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ messages: [{ id: 'wamid.OUT1' }] }) }; }
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    } },
    WA_API: 'https://graph.facebook.com/v21.0/',
    saved: [], cleared: [],
  });
  ctx.saveConversationTurn = (...a) => ctx.saved.push(a); ctx.clearHandoff_ = (id) => ctx.cleared.push(id);
  ctx.aiKey_ = (n) => (P[n] || ''); ctx.badChatId_ = () => false;
  for (const [f, n] of [['server/src/21_messaging.js', 'waToken_'], ['server/src/21_messaging.js', 'waPhoneId_'], ['server/src/21_messaging.js', 'waIsPhoneId_'], ['server/src/21_messaging.js', 'waTarget_'], ['server/src/21_messaging.js', 'waCall_'],
    ['server/src/43_nova_wa_forward.js', 'novaWaForward_'], ['server/src/43_nova_wa_forward.js', 'novaWaSafeErr_'], ['server/src/43_nova_wa_forward.js', 'novaWaForwardOut_'], ['server/src/42_nova_whatsapp_bridge.js', 'novaWaAuthorized_'], ['server/src/42_nova_whatsapp_bridge.js', 'novaWaBridge_']]) vm.runInContext(grab(f, n), ctx);
  vm.runInContext('var WA_API = "https://graph.facebook.com/v21.0/";', ctx);
  vm.runInContext(read('server/src/46_wa_send_media.js'), ctx);
  return { ctx, fetches, log, P };
}
const req = (over = {}) => Object.assign({ bridgeToken: TOKEN, operation: 'sendMedia', chatId: 'wa_201001112222', kind: 'image', mime: 'image/jpeg', media_base64: b64(JPEG), caption: 'الروشتة' }, over);
const send = (m, d) => vm.runInContext('novaWaBridge_(' + JSON.stringify(d) + ')', m.ctx);
const metaCalls = (m) => m.fetches.filter((f) => /graph\.facebook\.com/.test(f.u));
const novaCalls = (m) => m.fetches.filter((f) => /nova\.example/.test(f.u)).map((f) => JSON.parse(f.o.payload).messages[0]);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('a valid JPEG with a caption: uploaded as multipart to Meta, then sent as an image message to the customer, logged, and forwarded to NOVA with its bytes', () => {
  const m = make(); const r = send(m, req());
  assert.equal(r.ok, true); assert.equal(r.message_id, 'wamid.OUT1');
  const mc = metaCalls(m); assert.equal(mc.length, 2);
  assert.match(mc[0].u, /111222333\/media$/); assert.equal(mc[0].o.headers.Authorization, 'Bearer EAAtesttesttesttesttesttest');
  assert.equal(mc[0].o.payload.messaging_product, 'whatsapp'); assert.equal(mc[0].o.payload.type, 'image/jpeg'); assert.equal(mc[0].o.payload.file._mime, 'image/jpeg');
  assert.deepEqual(Buffer.from(mc[0].o.payload.file._bytes.map((x) => (x < 0 ? x + 256 : x))), JPEG);
  const body = JSON.parse(mc[1].o.payload); assert.equal(body.messaging_product, 'whatsapp'); assert.equal(body.to, '201001112222'); assert.equal(body.type, 'image'); assert.deepEqual(body.image, { id: 'MEDIA123', caption: 'الروشتة' });
  assert.equal(m.ctx.saved.length, 1); assert.equal(m.ctx.saved[0][0], 'wa_201001112222'); assert.match(m.ctx.saved[0][2], /^\[صورة\]/); assert.equal(m.ctx.saved[0][3], 'pharm'); assert.deepEqual(m.ctx.cleared, ['wa_201001112222']);
  const f = novaCalls(m); assert.equal(f.length, 1); assert.equal(f[0].direction, 'out'); assert.equal(f[0].type, 'image'); assert.equal(f[0].media_base64, b64(JPEG)); assert.equal(f[0].mime_type, 'image/jpeg'); assert.equal(f[0].text, 'الروشتة'); assert.equal(f[0].from, '201001112222');
  assert.equal(vm.runInContext('NOVA_WA_OUT_BYTES_', m.ctx), null, 'the pending bytes are cleared after the send');
});
t('PNG without a caption works; the image message has no caption field', () => {
  const m = make(); const r = send(m, req({ mime: 'image/png', media_base64: b64(PNG), caption: '' })); assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(metaCalls(m)[1].o.payload).image, { id: 'MEDIA123' });
});
t('refused before any Meta call: wrong token, bad chat id, unsupported kind/type, invalid base64, empty, wrong magic bytes, too large, long caption, missing WA_TOKEN', () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
  const cases = [
    [{ bridgeToken: 'x'.repeat(40) }, 'unauthorized'], [{ chatId: 'tg_123' }, 'invalid chat'], [{ chatId: 'wa_../x' }, 'invalid chat'],
    [{ kind: 'video' }, 'unsupported media kind'], [{ kind: 'document' }, 'unsupported media kind'], [{ kind: 'sticker' }, 'unsupported media kind'], [{ kind: '__proto__' }, 'unsupported media kind'], [{ kind: 'constructor' }, 'unsupported media kind'],
    [{ mime: 'image/gif' }, 'unsupported file type'], [{ mime: 'text/html' }, 'unsupported file type'], [{ mime: 'application/pdf' }, 'unsupported file type'],
    [{ media_base64: '***not base64***' }, 'invalid media'], [{ media_base64: '' }, 'invalid media'],
    [{ media_base64: b64(PNG) }, 'invalid media'], [{ mime: 'image/png', media_base64: b64(JPEG) }, 'invalid media'], [{ media_base64: b64(Buffer.from('<html><script>alert(1)</script></html>')) }, 'invalid media'],
    [{ media_base64: b64(big) }, 'media too large'], [{ media_base64: b64(Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024 - JPEG.length + 1)])) }, 'media too large'], [{ caption: 'ا'.repeat(1025) }, 'caption too long'],
  ];
  for (const [over, err] of cases) { const m = make(); const r = send(m, req(over)); assert.equal(r.ok, false, JSON.stringify(over).slice(0, 60)); assert.equal(r.error, err, JSON.stringify(over).slice(0, 60)); assert.equal(metaCalls(m).length, 0, 'no Meta call: ' + err); assert.equal(m.ctx.saved.length, 0); }
  const m = make({ props: { WA_TOKEN: '' } }); const r = send(m, req()); assert.equal(r.ok, false); assert.equal(r.error, 'WA_TOKEN missing'); assert.equal(metaCalls(m).length, 0);
});
t('exactly 5 MB is accepted', () => { const m = make(); const ok = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024 - JPEG.length)]); assert.equal(send(m, req({ media_base64: b64(ok) })).ok, true); });
t('upload failure: no message is sent, nothing is logged or forwarded, the error is returned', () => {
  const m = make({ uploadFail: true }); const r = send(m, req());
  assert.equal(r.ok, false); assert.match(r.error, /upload/); assert.equal(metaCalls(m).length, 1); assert.equal(m.ctx.saved.length, 0); assert.equal(novaCalls(m).length, 0);
  assert.equal(vm.runInContext('NOVA_WA_OUT_BYTES_', m.ctx), null);
});
t('send failure (24h window closed, code 131047): the Arabic reason is returned, nothing logged or forwarded, pending bytes cleared', () => {
  const m = make({ sendFail: 131047 }); const r = send(m, req());
  assert.equal(r.ok, false); assert.match(r.error, /24 ساعة/); assert.equal(m.ctx.saved.length, 0); assert.equal(novaCalls(m).length, 0); assert.equal(vm.runInContext('NOVA_WA_OUT_BYTES_', m.ctx), null);
});
t('the WhatsApp token and the bridge token never appear in the result or in the log', () => {
  for (const o of [{}, { uploadFail: true }, { sendFail: 131047 }]) { const m = make(o); const r = JSON.stringify(send(m, req())); const all = r + m.log.join('\n'); assert.ok(!all.includes('EAAtesttest') && !all.includes(TOKEN), 'no secrets'); }
});
t('a text-only reply and the other bridge operations still work (sendMedia did not shadow them)', () => {
  const m = make(); assert.equal(send(m, { bridgeToken: TOKEN, operation: 'nope', chatId: 'wa_201001112222' }).error, 'unsupported operation');
  assert.equal(send(m, { bridgeToken: 'y'.repeat(40), operation: 'sendMedia', chatId: 'wa_2' }).error, 'unauthorized');
});

// ---- voice notes (kind: audio) ----
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.from([0, 2]), Buffer.from('fake ogg opus bytes')]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A '), Buffer.from('fake m4a bytes')]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, 0, 0, 0, 0]), Buffer.from('fake mp3')]);
const AMR = Buffer.concat([Buffer.from('#!AMR\n'), Buffer.from('fake amr bytes')]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('fake webm bytes')]);
const areq = (over = {}) => Object.assign({ bridgeToken: TOKEN, operation: 'sendMedia', chatId: 'wa_201001112222', kind: 'audio', mime: 'audio/ogg', media_base64: b64(OGG) }, over);
t('voice note (ogg/opus): uploaded as audio, sent as an audio message WITHOUT caption, logged as a voice note, forwarded to NOVA with its bytes', () => {
  const m = make(); const r = send(m, areq()); assert.equal(r.ok, true); assert.equal(r.message_id, 'wamid.OUT1');
  const mc = metaCalls(m); assert.equal(mc.length, 2); assert.match(mc[0].u, /111222333\/media$/); assert.equal(mc[0].o.payload.type, 'audio/ogg'); assert.equal(mc[0].o.payload.file._mime, 'audio/ogg');
  const body = JSON.parse(mc[1].o.payload); assert.equal(body.type, 'audio'); assert.deepEqual(body.audio, { id: 'MEDIA123' }); assert.equal(body.to, '201001112222'); assert.ok(!('caption' in body.audio));
  assert.equal(m.ctx.saved[0][2], '[رسالة صوتية]'); assert.deepEqual(m.ctx.cleared, ['wa_201001112222']);
  const f = novaCalls(m); assert.equal(f.length, 1); assert.equal(f[0].type, 'audio'); assert.equal(f[0].direction, 'out'); assert.equal(f[0].mime_type, 'audio/ogg'); assert.equal(f[0].media_base64, b64(OGG));
});
t('every WhatsApp audio format is accepted with its own magic bytes: mp4/m4a (iPhone), mpeg, aac, amr', () => {
  const AAC = Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.from('fake adts aac bytes')]);
  const MP3B = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.from('fake mp3 frame bytes')]);
  for (const [mime, buf] of [['audio/mp4', M4A], ['audio/mpeg', MP3], ['audio/mpeg', MP3B], ['audio/aac', AAC], ['audio/amr', AMR], ['audio/ogg', OGG]]) {
    const m = make(); const r = send(m, areq({ mime, media_base64: b64(buf) })); assert.equal(r.ok, true, mime); assert.equal(JSON.parse(metaCalls(m)[1].o.payload).type, 'audio');
  }
});
t('voice: refused before any Meta call — webm (what Chrome records), wav, video, an image mime on an audio request, an audio mime on an image request, wrong magic bytes, a caption, empty, bad base64', () => {
  const cases = [
    [{ mime: 'audio/webm', media_base64: b64(WEBM) }, 'unsupported file type'], [{ mime: 'audio/wav' }, 'unsupported file type'], [{ mime: 'video/mp4', kind: 'video' }, 'unsupported media kind'],
    [{ mime: 'image/png', media_base64: b64(PNG) }, 'unsupported file type'], [{ kind: 'image', mime: 'audio/ogg' }, 'unsupported file type'],
    [{ media_base64: b64(M4A) }, 'invalid media'], [{ mime: 'audio/mp4', media_base64: b64(OGG) }, 'invalid media'], [{ media_base64: b64(Buffer.from('<html>not audio at all</html>')) }, 'invalid media'],
    [{ mime: 'audio/mpeg', media_base64: b64(OGG) }, 'invalid media'], [{ mime: 'audio/aac', media_base64: b64(OGG) }, 'invalid media'], [{ mime: 'audio/amr', media_base64: b64(OGG) }, 'invalid media'], [{ mime: 'audio/amr', media_base64: b64(Buffer.concat([Buffer.from('#!AMX\n'), Buffer.from('near miss bytes')])) }, 'invalid media'], [{ mime: 'audio/aac', media_base64: b64(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.from('mp3 frame is not adts')])) }, 'invalid media'],
    [{ caption: 'hello' }, 'caption not allowed'], [{ media_base64: '' }, 'invalid media'], [{ media_base64: '***' }, 'invalid media'],
  ];
  for (const [over, err] of cases) { const m = make(); const r = send(m, areq(over)); assert.equal(r.ok, false, JSON.stringify(over).slice(0, 50)); assert.equal(r.error, err, JSON.stringify(over).slice(0, 50)); assert.equal(metaCalls(m).length, 0); assert.equal(m.ctx.saved.length, 0); }
});
t('voice size: exactly 5 MB accepted, one byte more refused', () => {
  const mk = (n) => Buffer.concat([OGG, Buffer.alloc(n - OGG.length)]);
  assert.equal(send(make(), areq({ media_base64: b64(mk(5 * 1024 * 1024)) })).ok, true);
  const m = make(); const r = send(m, areq({ media_base64: b64(mk(5 * 1024 * 1024 + 1)) })); assert.equal(r.error, 'media too large'); assert.equal(metaCalls(m).length, 0);
});
t('voice: upload failure and the 24 h window behave like images (nothing logged or forwarded, bytes cleared)', () => {
  let m = make({ uploadFail: true }); let r = send(m, areq()); assert.equal(r.ok, false); assert.equal(m.ctx.saved.length, 0); assert.equal(novaCalls(m).length, 0);
  m = make({ sendFail: 131047 }); r = send(m, areq()); assert.match(r.error, /24 ساعة/); assert.equal(m.ctx.saved.length, 0); assert.equal(vm.runInContext('NOVA_WA_OUT_BYTES_', m.ctx), null);
});
t('registered in files.json and built into Code.js', () => {
  assert.ok(JSON.parse(read('server/files.json')).includes('src/46_wa_send_media.js')); assert.ok(read('server/Code.js').includes('function waSendMedia_('));
});
console.log(`PASS wa send media: ${n} cases`);
