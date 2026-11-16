// Meta "failed" delivery status -> a system note in the NOVA chat (never anything else, never a customer message). Run: node tools/test-wa-status-failed.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const grab = (file, name) => { const src = read(file); const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name + ' in ' + file); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } throw new Error('unbalanced ' + name); };
const TOKEN = 'b'.repeat(40);
function make() {
  const fetches = [], P = { NOVA_WA_BRIDGE_TOKEN: TOKEN, NOVA_WA_BRIDGE_URL: 'https://nova.example/api/v1/webhooks/whatsapp-bridge' }, cache = {}, ones = [], ins = [];
  const ctx = vm.createContext({ String, Number, Object, Array, JSON, Math, RegExp, parseInt, isNaN, Error, Date, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in P ? P[k] : null), setProperty: (k, v) => { P[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); } }) },
    Utilities: { formatDate: () => '11-16 22:59' }, UrlFetchApp: { fetch(u, o) { fetches.push({ u, o }); return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
    waOne_: (m) => ones.push(m), waEcho_() {}, waSenderId_: (m) => m.from, novaWaForwardIn_: (m) => ins.push(m) });
  for (const [f, n] of [['server/src/43_nova_wa_forward.js', 'novaWaForward_'], ['server/src/43_nova_wa_forward.js', 'novaWaSafeErr_'], ['server/src/21_messaging.js', 'handleWhatsAppWebhook_']]) vm.runInContext(grab(f, n), ctx);
  vm.runInContext(read('server/src/47_wa_status.js'), ctx);
  return { ctx, fetches, P, ones, ins };
}
const hook = (m, v) => vm.runInContext('handleWhatsAppWebhook_(' + JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: v }] }] }) + ')', m.ctx);
const failed = (o = {}) => ({ id: 'wamid.OUT1', status: 'failed', timestamp: '1763320000', recipient_id: '201001112222', errors: [{ code: 131026, title: 'Message undeliverable' }], ...o });
const sent = (m) => m.fetches.filter((f) => /nova\.example/.test(f.u)).map((f) => JSON.parse(f.o.payload).messages[0]);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('a failed status is forwarded to NOVA as a system note with the reason in Arabic and the code', () => {
  const m = make(); hook(m, { statuses: [failed()] }); const f = sent(m); assert.equal(f.length, 1);
  assert.equal(f[0].direction, 'sys'); assert.equal(f[0].type, 'status_failed'); assert.equal(f[0].id, 'fail_wamid.OUT1'); assert.equal(f[0].from, '201001112222'); assert.equal(f[0].timestamp, '1763320000');
  assert.ok(f[0].text.startsWith('⚠️ واتساب ما سلّمش رسالتك للعميل')); assert.ok(f[0].text.includes('الرقم مش على واتساب') && f[0].text.includes('131026'));
});
t('known error codes get a plain reason; an unknown code shows WhatsApp\'s own title; no error object is still a note', () => {
  const cases = [[131047, /24 ساعة/], [131053, /رفض الملف/], [131026, /مش على واتساب/], [131051, /نوع الرسالة/], [131049, /مش بيوصّل رسالتنا/]];
  for (const [code, re] of cases) { const m = make(); hook(m, { statuses: [failed({ errors: [{ code, title: 'x' }] })] }); assert.match(sent(m)[0].text, re, String(code)); assert.ok(sent(m)[0].text.includes('(' + code + ')')); }
  let m = make(); hook(m, { statuses: [failed({ errors: [{ code: 999999, title: 'Some new Meta error' }] })] }); assert.ok(sent(m)[0].text.includes('Some new Meta error') && sent(m)[0].text.includes('999999'));
  m = make(); hook(m, { statuses: [failed({ errors: undefined })] }); assert.equal(sent(m).length, 1); assert.ok(sent(m)[0].text.includes('سبب غير معروف'));
});
t('sent / delivered / read statuses are ignored (nothing is forwarded)', () => {
  for (const st of ['sent', 'delivered', 'read']) { const m = make(); hook(m, { statuses: [failed({ status: st })] }); assert.equal(sent(m).length, 0, st); }
});
t('no recipient number (e.g. a username-only user) -> skipped; text capped; the same failure twice is forwarded once', () => {
  let m = make(); hook(m, { statuses: [failed({ recipient_id: undefined, recipient_user_id: 'US.abc' })] }); assert.equal(sent(m).length, 0);
  m = make(); hook(m, { statuses: [failed({ errors: [{ code: 1, title: 'ا'.repeat(5000) }] })] }); assert.ok(sent(m)[0].text.length <= 300, 'capped');
  m = make(); hook(m, { statuses: [failed(), failed()] }); assert.equal(sent(m).length, 1, 'dedupe by id');
});
t('real messages in the same webhook are processed exactly as before; a broken status never breaks them', () => {
  const m = make(); hook(m, { messages: [{ id: 'wamid.IN1', from: '201001112222', type: 'text', text: { body: 'hi' } }], statuses: [null, { status: 'failed' }, failed(), 'garbage', { status: 'failed', errors: 7, recipient_id: '2010' }] });
  assert.equal(m.ones.length, 1); assert.equal(m.ins.length, 1);
});
t('a failed status without a message id is ignored; WhatsApp\'s own text is scrubbed of tokens and links', () => {
  let m = make(); hook(m, { statuses: [failed({ id: undefined })] }); assert.equal(sent(m).length, 0);
  m = make(); hook(m, { statuses: [failed({ errors: [{ code: 4242, title: 'bad token EAAabc123def and Bearer sekret999 at https://graph.example/x?sig=1' }] })] });
  const txt = sent(m)[0].text; assert.ok(!/EAAabc123def|sekret999|https?:\/\//.test(txt), txt);
});
t('no secrets in the note, and nothing is forwarded when the NOVA bridge is not configured', () => {
  const m = make(); hook(m, { statuses: [failed({ errors: [{ code: 131026, title: 'x', error_data: { details: 'Bearer ' + TOKEN } }] })] }); assert.ok(!JSON.stringify(sent(m)).includes(TOKEN));
  const m2 = make(); delete m2.P.NOVA_WA_BRIDGE_TOKEN; hook(m2, { statuses: [failed()] }); assert.equal(sent(m2).length, 0);
});
t('registered in files.json and built into Code.js', () => { assert.ok(JSON.parse(read('server/files.json')).includes('src/47_wa_status.js')); assert.ok(read('server/Code.js').includes('function waStatusNote_(')); });
console.log(`PASS wa status failed: ${n} cases`);
