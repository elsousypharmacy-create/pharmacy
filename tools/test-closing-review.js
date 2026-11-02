const fs = require('fs'), vm = require('vm'), assert = require('assert');
const path = require('path'), root = path.join(__dirname, '..');
let props = {}, cache = {}, updated = 1, pdfVersion = 1, readCount = 0;
const iter = a => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
const file = (id, text, time = () => updated) => ({ getId: () => id, getName: () => id,
  getLastUpdated: () => new Date(time()), getSize: () => text.length, getUrl: () => 'private-source',
  getBlob: () => ({ getDataAsString: () => { readCount++; return text; }, getBytes: () => [] }) });
const debt = 'عميل (123)\nإجمالى الديون قبل 1000\nإجمالى الديون بعد 500';
const raw = file('debits2026-11-01.txt', debt);
const pdfFile = file('dailyclose_2026-11-01_x.pdf', 'pdf', () => pdfVersion);
const ctx = { console, Date, isFinite, SALES_FOLDER: 'sales',
  CacheService: { getScriptCache: () => ({ get: k => cache[k], put: (k,v) => cache[k] = v }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], setProperty: (k,v) => props[k] = v,
    getKeys: () => Object.keys(props), deleteProperty: k => delete props[k] }) },
  Utilities: { formatDate: d => d.toISOString().slice(0,10) },
  DriveApp: { getFolderById: id => ({ getFilesByName: n => iter(n.startsWith('debits') ? [raw] : []),
    searchFiles: () => iter(id === '19EZWuzPtOIyr-9mpEKTKiKqeIylZ5a3v' ? [pdfFile] : []) }) }
};
vm.createContext(ctx);
for (const f of ['69_closing.js', '69_closing_pdf.js']) vm.runInContext(fs.readFileSync(path.join(root,'server/src',f),'utf8'),ctx);
let x = ctx.closingDay_('2026-11-01');
assert.equal(x.raw_collections,500); assert.equal(x.collected,null); assert.equal(x.expected_cash,null);
const before = readCount; ctx.closingDay_('2026-11-01'); assert.equal(readCount,before);
updated++; ctx.closingDay_('2026-11-01'); assert(readCount > before, 'changed raw export invalidates cache');
const pdf = { daily: { rows: { drawer: {sys:10420.62,user:10423,diff:2.38}, custody:{sys:250},
  collected_cash:{sys:4233.38}, sales_cash:{sys:5937.24}, bank_card:{sys:1406} } } };
ctx.closingApplyPdf_(x,pdf); assert.equal(x.collected,4233.38); assert.equal(x.expected_cash,10170.62);
assert.equal(x.expected_drawer_total,10420.62); assert.equal(x.raw_collections,500);
assert.equal(pdf.daily.rows.drawer.diff,2.38, 'do not replace actual counted difference');
const discrepancy = ctx.closingChecks_({cash_net:5967.24,card:1221},pdf);
assert.equal(discrepancy.length,2); assert.equal(discrepancy[0].diff,30); assert.equal(discrepancy[1].diff,-185);
ctx.closingApplyPdf_(x,{}); assert.equal(x.collected,null); assert.equal(x.expected_cash,null);
ctx.closingApplyPdf_(x,{daily:{rows:{drawer:{sys:100},collected_cash:{sys:0}}}});
assert.equal(x.collected,0); assert.equal(x.expected_cash,null, 'unknown custody must not become zero');
ctx.pdfContent_ = () => 'parsed'; ctx.pdfBin_ = () => 'bytes';
ctx.pdfParseClose_ = () => ({found:6,rows:{drawer:{sys:100,user:600,diff:500}}});
let cp = ctx.closingPdfRead_('2026-11-01'); assert.equal(cp.daily.rows.drawer.diff,500);
ctx.pdfParseClose_ = () => ({found:6,rows:{drawer:{sys:100,user:200,diff:100}}});
cp = ctx.closingPdfRead_('2026-11-01'); assert.equal(cp.daily.rows.drawer.diff,500, 'unchanged cache is reused');
pdfVersion++; cp = ctx.closingPdfRead_('2026-11-01'); assert.equal(cp.daily.rows.drawer.diff,100, 'updated PDF refreshes result');
console.log('Closing review: cash classification, custody, unknowns, actual difference and source cache checks passed');
