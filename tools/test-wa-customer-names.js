// WhatsApp chats are linked to the pharmacy's customer database by phone number (read-only): wa_<number> -> name from the Customers sheet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const grab = (file, name) => { const src = read(file); const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name + ' in ' + file); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } throw new Error('unbalanced ' + name); };

function make(customers, logRows, props = {}) {
  const counters = { sheetReads: 0 };
  const store = {};
  const cache = { get: (k) => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, putAll: (o) => { Object.assign(store, o); }, getAll: (ks) => { const o = {}; ks.forEach(k => { if (k in store) o[k] = store[k]; }); return o; }, removeAll: (ks) => ks.forEach(k => delete store[k]) };
  const header = ['phone', 'name'];
  const sheet = { getLastRow: () => customers.length + 1, getLastColumn: () => 2, getRange: (r, c, n, m) => ({ getValues: () => { counters.sheetReads++; if (r === 1) return [header]; return customers.map(x => [x.phone, x.name]); } }) };
  const ctx = vm.createContext({
    String, Number, Object, Array, JSON, Math, RegExp, parseInt, isNaN, Error,
    CRM_SHEET_ID: 'crm',
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || '', getProperties: () => props }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => (n === 'Customers' ? sheet : null) }) },
    chatLogRows_: () => logRows, holdOn_: () => false,
    getHeaderMap: () => ({ phone: 0, name: 1 }),
  });
  for (const [f, n] of [['server/src/71_agents.js', 'normalizeAgentDigits_'], ['server/src/71_agents.js', 'canonicalEgyptPhone_'], ['server/src/80_cache_home.js', 'fxCacheGet_'], ['server/src/80_cache_home.js', 'fxCachePut_'],
    ['server/src/25_bot_history_ui.js', 'getKnownCustomerName_'], ['server/src/25_bot_history_ui.js', 'chatWho_'], ['server/src/25_bot_history_ui.js', 'getVerifiedPhone_'], ['server/src/25_bot_history_ui.js', 'getCustomerPhone_'], ['server/src/41_bot_chat_admin.js', 'getBotChats']]) vm.runInContext(grab(f, n), ctx);
  vm.runInContext(read('server/src/45_wa_customer_names.js'), ctx);
  return { ctx, counters };
}
const run = (m, code) => vm.runInContext(code, m.ctx);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const CUSTOMERS = [{ phone: 1227632207, name: 'أحمد علي' }, { phone: '01001823577', name: 'منى حسن' }, { phone: '+20 115 248 4952', name: 'سعيد' }, { phone: '01112345678', name: '   ' }, { phone: '', name: 'بلا رقم' }];

t('waChatPhone_: wa_ ids with an Egyptian mobile in any common format; BSUIDs, other channels and foreign numbers give nothing', () => {
  const m = make([], []);
  for (const [id, want] of [['wa_201227632207', '01227632207'], ['wa_+20 122 763 2207', '01227632207'], ['wa_1227632207', '01227632207'], ['wa_01227632207', '01227632207'], ['wa_US.13491234567890', ''], ['wa_US.1000000000', ''], ['tg_201227632207', ''], ['201227632207', ''], ['wa_447710173736', ''], ['wa_', ''], [null, '']]) assert.equal(run(m, `waChatPhone_(${JSON.stringify(id)})`), want, String(id));
});
t('customerNameMap_: sheet phones stored as numbers (leading zero lost), +20 and 0 forms all meet; blank names and blank phones are skipped', () => {
  const m = make(CUSTOMERS, []); const map = run(m, 'customerNameMap_()');
  assert.deepEqual(Object.assign({}, map), { '01227632207': 'أحمد علي', '01001823577': 'منى حسن', '01152484952': 'سعيد' });
});
t('the sheet is read once for many lookups (cache), and an unreadable sheet is not cached as empty', () => {
  const m = make(CUSTOMERS, []); run(m, 'customerNameMap_(); customerNameMap_(); waCustomerName_("wa_201227632207"); waCustomerName_("wa_201001823577")');
  assert.equal(m.counters.sheetReads, 1, 'the data is read once');
  const bad = make(CUSTOMERS, []); vm.runInContext('SpreadsheetApp = { openById: function(){ throw new Error("x"); } };', bad.ctx); assert.deepEqual(Object.assign({}, run(bad, 'customerNameMap_()')), {});
  vm.runInContext('SpreadsheetApp = { openById: function(){ return { getSheetByName: function(){ return { getLastRow: function(){ return 3; }, getLastColumn: function(){ return 2; }, getRange: function(){ return { getValues: function(){ return [["01227632207", "أحمد"], ["01001823577", "منى"]]; } }; } }; } }; } };', bad.ctx);
  assert.equal(run(bad, 'waCustomerName_("wa_201227632207")'), 'أحمد', 'after a failure the next call reads again (the failure was not cached)');
});
t('an empty result (no named customers) is not cached: the next call reads the sheet again', () => {
  const m = make([{ phone: '01227632207', name: '' }], []);
  assert.deepEqual(Object.assign({}, run(m, 'customerNameMap_()')), {}); run(m, 'customerNameMap_()');
  assert.equal(m.counters.sheetReads, 2);
});
t('getBotChats: chats without a name get the customer name and phone; the CRM name wins over a stored one; unknown numbers, BSUID and Telegram chats are untouched', () => {
  const rows = [
    ['2026-11-15 15:36', 'wa_201227632207', '', '', 'user', 'عايزة لبن', ''],
    ['2026-11-15 13:32', 'wa_201001823577', 'Mona WA', '', 'user', '[صورة]', ''],
    ['2026-11-15 12:22', 'wa_201555555555', '', '', 'user', 'ازيك', ''],
    ['2026-11-14 10:00', 'wa_US.1349000111', 'ملف', '', 'user', 'hi', ''],
    ['2026-11-14 09:00', '123456', 'تيليجرام', '', 'user', 'hi', ''],
  ];
  const m = make(CUSTOMERS, rows); const list = JSON.parse(run(m, 'JSON.stringify(getBotChats().chats)'));
  const by = Object.fromEntries(list.map(c => [c.id, c]));
  assert.equal(by.wa_201227632207.name, 'أحمد علي'); assert.equal(by.wa_201227632207.phone, '01227632207'); assert.equal(by.wa_201227632207.crm, true);
  assert.equal(by.wa_201001823577.name, 'منى حسن', 'the pharmacy record wins over the WhatsApp profile name'); assert.equal(by.wa_201001823577.crm, true);
  assert.equal(by.wa_201555555555.name, ''); assert.equal(by.wa_201555555555.crm, undefined); assert.equal(by.wa_201555555555.phone, '01555555555', 'phone still shown');
  assert.equal(by['wa_US.1349000111'].name, 'ملف'); assert.equal(by['wa_US.1349000111'].phone, '');
  assert.equal(by['123456'].name, 'تيليجرام'); assert.equal(by['123456'].crm, undefined);
  assert.equal(m.counters.sheetReads, 1, 'one sheet read for the whole list');
});
t('getBotChats works when the customers sheet is missing or unreadable (names stay as they were)', () => {
  const m = make(CUSTOMERS, [['2026-11-15 15:36', 'wa_201227632207', 'اسم', '', 'user', 'x', '']]);
  vm.runInContext('SpreadsheetApp = { openById: function(){ throw new Error("no access"); } };', m.ctx);
  const list = JSON.parse(run(m, 'JSON.stringify(getBotChats().chats)')); assert.equal(list[0].name, 'اسم');
});
t('getKnownCustomerName_ / chatWho_: a WhatsApp chat finds its name from its own number; a verified phone still takes precedence', () => {
  let m = make(CUSTOMERS, []);
  assert.equal(run(m, 'getKnownCustomerName_("wa_201227632207")'), 'أحمد علي');
  assert.equal(run(m, 'chatWho_("wa_201227632207").n'), 'أحمد علي'); assert.equal(run(m, 'chatWho_("wa_201227632207").p'), '01227632207');
  assert.equal(run(m, 'getKnownCustomerName_("wa_201555555555")'), '');
  m = make(CUSTOMERS, [], { vphone_wa_201227632207: '01001823577' });
  assert.equal(run(m, 'getKnownCustomerName_("wa_201227632207")'), 'منى حسن', 'verified phone first');
});
t('the new module is registered in files.json and built into Code.js', () => {
  assert.ok(JSON.parse(read('server/files.json')).includes('src/45_wa_customer_names.js'));
  assert.ok(read('server/Code.js').includes('function waChatPhone_('));
});
console.log(`PASS wa customer names: ${n} cases`);
