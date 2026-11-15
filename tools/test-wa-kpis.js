const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const MIN = 60000, H = 3600000, D = 86400000;
const NOW = Date.UTC(2026, 10, 15, 10, 0, 0); // Sun 2026-11-15 12:00 Africa/Cairo (UTC+2)
const TODAY = Date.UTC(2026, 10, 14, 22, 0, 0);
const at = (d, hh, mm = 0, ss = 0) => TODAY + d * D + hh * H + mm * MIN + ss * 1000;
const stamp = (t) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
  const o = {}; p.forEach((x) => { o[x.type] = x.value; });
  return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}:${o.second}`;
};

const ctx = vm.createContext({
  Date, Intl, Math, Number, String, Object, Array, JSON, isNaN, parseInt,
  STAFF_SHEET_ID: 'fixture',
  CHAT_LOG_SHEET: 'محادثات البوت',
  SpreadsheetApp: { openById: () => { throw new Error('sheet should be stubbed in tests'); } },
  Utilities: {
    formatDate(date, tz, pattern) {
      const d = new Date(date);
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d);
      const o = {}; parts.forEach((x) => { o[x.type] = x.value; });
      if (pattern === 'yyyy-MM-dd') return `${o.year}-${o.month}-${o.day}`;
      if (pattern === 'H') return String(+o.hour % 24);
      if (pattern === 'yyyy-MM-dd HH:mm:ss') return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}:${o.second}`;
      return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}:${o.second}`;
    },
    parseDate(s, tz, pattern) {
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s));
      if (!m) throw new Error('bad date ' + s);
      // defer to waKpiParseStamp_ fallback by throwing — actually implement offset invert
      const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], sec = +m[6];
      const guess = Date.UTC(y, mo - 1, d, h, mi, sec);
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const offset = (t) => {
        const o = {}; fmt.formatToParts(new Date(t)).forEach((p) => { o[p.type] = p.value; });
        return Date.UTC(+o.year, +o.month - 1, +o.day, (+o.hour) % 24, +o.minute, +o.second) - Math.floor(t / 1000) * 1000;
      };
      const t1 = guess - offset(guess);
      return new Date(t1 - (offset(t1) - offset(guess)));
    }
  }
});
vm.runInContext(read('server/src/44_wa_kpis.js'), ctx);

const NAMES = { wa_1: 'منى التجريبية', wa_2: 'علي التجريبي', wa_3: 'سها التجريبية', wa_4: 'هدى التجريبية', wa_5: 'كريم التجريبي' };
const ev = (c, k, t, extra = {}) => [stamp(t), c, NAMES[c], '', k === 'in' ? 'user' : k, extra.text || '', extra.photos || ''];
const rows = [
  ev('wa_1', 'in', at(0, 9)), ev('wa_1', 'bot', at(0, 9, 0, 5)), ev('wa_1', 'in', at(0, 9, 1), { text: '[صورة]' }), ev('wa_1', 'in', at(0, 9, 2), { text: '[ملصق]' }), ev('wa_1', 'pharm', at(0, 9, 5)),
  ev('wa_2', 'in', at(-3, 14)), ev('wa_2', 'pharm', at(-3, 14, 2)),
  ev('wa_2', 'in', at(0, 10), { text: '[صوت]' }), ev('wa_2', 'pharm', at(0, 10, 1)), ev('wa_2', 'in', at(0, 10, 30)), ev('wa_2', 'out', at(0, 10, 33)),
  ev('wa_3', 'in', at(0, 11)), ev('wa_3', 'sys', at(0, 11, 0, 30)), ev('wa_3', 'in', at(0, 11, 5)),
  ev('wa_4', 'in', at(-1, 20)), ev('wa_4', 'out', at(-1, 20, 10)),
  ev('wa_5', 'in', at(-3, 9)),
  ev('tg_9', 'in', at(0, 9), { text: 'telegram must be ignored' }),
];

const data = ctx.waKpiDataFromRows_(rows);
assert.equal(data.events.some((e) => e.c === 'tg_9'), false, 'telegram chats are ignored');
assert.equal(data.events.filter((e) => e.c === 'wa_1' && e.m === 'image').length, 1);
assert.equal(data.events.filter((e) => e.c === 'wa_1' && e.m === 'sticker').length, 1);
assert.equal(data.events.filter((e) => e.c === 'wa_2' && e.m === 'audio').length, 1);

const { today: T, yesterday: Y } = ctx.kpHeadline(data, NOW);
assert.equal(T.chats, 3); assert.equal(T.msgs, 11); assert.equal(T.inMsgs, 7); assert.equal(T.botMsgs, 1); assert.equal(T.staffMsgs, 3);
assert.equal(Y.chats, 1); assert.equal(Y.msgs, 2);
assert.equal(T.firstResponse.n, 3); assert.equal(T.firstResponse.avg, 3 * MIN); assert.equal(T.firstResponse.median, 3 * MIN);
assert.equal(Y.firstResponse.n, 1); assert.equal(Y.firstResponse.avg, 10 * MIN);
assert.equal(T.waitingOpen, 1);
assert.equal(T.waiting.length, 2); assert.equal(T.waiting[0].c, 'wa_3'); assert.equal(!!T.waiting[0].open, true); assert.equal(T.waiting[1].c, 'wa_5'); assert.equal(!!T.waiting[1].open, false);
assert.equal(T.customers.total, 3); assert.equal(T.customers.newC, 2); assert.equal(T.customers.returning, 1);
assert.equal(T.media.image, 1); assert.equal(T.media.audio, 1); assert.equal(T.media.video, 0); assert.equal(T.media.document, 0); assert.equal(T.media.sticker, 1); assert.equal(T.media.other, 0);
assert.equal(T.mediaTotal, 3);
assert.equal(T.hours[9], 3); assert.equal(T.hours[10], 2); assert.equal(T.hours[11], 2);

// End-to-end action with a stubbed sheet (read-only: getSheetByName, never insertSheet)
let insertCalled = false;
const display = [['الوقت', 'chat', 'الاسم', 'الموبايل', 'من', 'الرسالة', 'صور']].concat(rows);
ctx.SpreadsheetApp = {
  openById: () => ({
    getSheetByName: (name) => {
      assert.equal(name, 'محادثات البوت');
      return {
        getLastRow: () => display.length,
        getRange: (r, c, n, cols) => ({ getDisplayValues: () => display.slice(r - 1, r - 1 + n).map((row) => row.slice(c - 1, c - 1 + cols)) }),
        insertSheet: () => { insertCalled = true; }
      };
    },
    insertSheet: () => { insertCalled = true; }
  })
};
ctx.Date.now = () => NOW;
const origDate = ctx.Date;
// Date.now used in getWhatsAppKpis
const RealDate = Date;
function FrozenDate(...args) { return new RealDate(...(args.length ? args : [NOW])); }
FrozenDate.now = () => NOW;
FrozenDate.UTC = RealDate.UTC;
FrozenDate.parse = RealDate.parse;
Object.setPrototypeOf(FrozenDate, RealDate);
ctx.Date = FrozenDate;

const res = ctx.getWhatsAppKpis({ range: 'today' });
assert.equal(res.ok, true);
assert.equal(res.source, 'chat-log-v1');
assert.equal(res.chats, 3);
assert.equal(res.msgs, 11);
assert.equal(res.waitingOpen, 1);
assert.equal(res.today.chats, 3);
assert.equal(res.yesterday.chats, 1);
assert.equal(res.firstResponse.avgText, '3 د');
assert.equal(insertCalled, false, 'never creates the sheet');

const missing = ctx.getWhatsAppKpis({ range: 'today' });
ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: () => null, insertSheet: () => { insertCalled = true; } }) };
const empty = ctx.getWhatsAppKpis({ range: 'today' });
assert.equal(empty.ok, true);
assert.equal(empty.chats, 0);
assert.equal(insertCalled, false);

const html = read('index.html');
assert(html.includes("go('bot',1)") || html.includes("go(\\'bot\\',1)") || html.includes('go(\'bot\',1)'));
assert(html.includes('id="homeWaKpis"'));
assert(html.includes('function pgWaKpis('));
assert(html.includes("['kpis', function(){ return 'مؤشرات الواتساب'; }]"));
assert(html.includes('getWhatsAppKpis'));
const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
new vm.Script(inline, { filename: 'index.html' });

const files = JSON.parse(read('server/files.json'));
assert(files.includes('src/44_wa_kpis.js'));
const routing = read('server/src/05_routing.js');
assert(routing.includes("if (action === 'getWhatsAppKpis')"));
assert(routing.includes('getWhatsAppKpis: 1'));

console.log('OK WhatsApp dashboard KPIs', res.chats, 'chats', res.msgs, 'msgs');
