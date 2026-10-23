// Verifies server/Code.js (bundle of server/src) is equivalent to the original single file.
// usage: node tools/verify-split.js <original Code.js> <acorn path>
const fs = require('fs'), path = require('path'), vm = require('vm');
const [,, origP, acornPath] = process.argv; const acorn = require(acornPath);
const root = path.join(__dirname, '..', 'server');
const orig = fs.readFileSync(origP, 'utf8');
const list = JSON.parse(fs.readFileSync(path.join(root, 'files.json'), 'utf8'));
const bundle = fs.readFileSync(path.join(root, 'Code.js'), 'utf8');
let fail = 0; const bad = m => { console.log('FAIL:', m); fail++; };
function chunks(src) { const ast = acorn.parse(src, { ecmaVersion: 'latest' }); const o = []; let p = 0;
  ast.body.forEach((s, i) => { const e = i === ast.body.length - 1 ? src.length : s.end; o.push({ s, text: src.slice(p, e) }); p = s.end; }); return o; }
const nm = s => s.type === 'FunctionDeclaration' ? [s.id.name] : s.type === 'VariableDeclaration' ? s.declarations.map(d => d.id.name) : [];
const norm = t => t.replace(/^\/\/ ==== MODULE .*$/m, '').trim();
const oc = chunks(orig), oNames = oc.flatMap(c => nm(c.s));
const nc = []; for (const f of list) nc.push(...chunks(fs.readFileSync(path.join(root, f), 'utf8')));
const nNames = nc.flatMap(c => nm(c.s));
console.log('original: ' + oc.length + ' top-level statements, ' + oNames.length + ' names');
console.log('split:    ' + nc.length + ' top-level statements, ' + nNames.length + ' names, ' + list.length + ' files');
const cnt = {}; nNames.forEach(n => cnt[n] = (cnt[n] || 0) + 1);
oNames.forEach(n => { if (cnt[n] !== 1) bad('name ' + n + ' appears ' + (cnt[n] || 0) + ' times'); });
nNames.forEach(n => { if (!oNames.includes(n)) bad('extra name ' + n); });
if (new Set(oNames).size !== oNames.length) bad('duplicate names in original');
// exact multiset equality of statement text (ignoring surrounding whitespace)
const bag = a => { const m = {}; a.forEach(c => { const k = norm(c.text); m[k] = (m[k] || 0) + 1; }); return m; };
const bo = bag(oc), bn = bag(nc); let diff = 0;
for (const k in bo) if (bo[k] !== bn[k]) diff++; for (const k in bn) if (!(k in bo)) diff++;
if (diff) bad(diff + ' statements differ between original and split'); else console.log('statement text multiset: identical');
// bundle equals concatenation of modules (already enforced by build --check)
const rebuilt = list.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + '\n';
if (rebuilt !== bundle) bad('Code.js is not the build of src'); else console.log('Code.js == build(src): identical');
// load both in a sandbox with stubbed Apps Script services; compare every global
function load(src) { const sb = {}; const st = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : st, apply: () => st, construct: () => st });
  ['PropertiesService','CacheService','SpreadsheetApp','DriveApp','UrlFetchApp','ScriptApp','Utilities','Session','LockService','ContentService','HtmlService','Logger','MailApp','CardService','Drive','Sheets'].forEach(k => sb[k] = st);
  sb.console = console; vm.createContext(sb); vm.runInContext(src, sb); return sb; }
let A, B; try { A = load(orig); B = load(bundle); } catch (e) { bad('load error: ' + e.message); }
if (A && B) { let n = 0; for (const k of oNames) { n++; const a = A[k], b = B[k];
  if (typeof a !== typeof b) bad('typeof ' + k); else if (typeof a === 'function' && a.toString() !== b.toString()) bad('source ' + k);
  else if (typeof a !== 'function' && typeof a !== 'object' && a !== b) bad('value ' + k); else if (typeof a === 'object' && JSON.stringify(a) !== JSON.stringify(b)) bad('value ' + k); }
  console.log('sandbox load: ' + n + ' globals compared (function source / var value) between original and split bundle'); }
console.log(fail ? 'RESULT: FAILED (' + fail + ')' : 'RESULT: PASS'); process.exit(fail ? 1 : 0);
