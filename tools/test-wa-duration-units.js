// Dashboard durations use English units (m, s, h, d), never د / س / ث / يوم.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const grab = (name) => { const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name + ' exists'); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } throw new Error('unbalanced'); };
const ctx = vm.createContext({});
vm.runInContext(grab('enDur') + '\n' + grab('waKpiWaitDur'), ctx);
const en = (t) => vm.runInContext('enDur(' + JSON.stringify(t) + ')', ctx);
const wait = (ms) => vm.runInContext('waKpiWaitDur(' + ms + ')', ctx);
assert.equal(en('8 د 3 ث'), '8m 3s');
assert.equal(en('3 د'), '3m');
assert.equal(en('2 س 5 د'), '2h 5m');
assert.equal(en('1 يوم 3 س'), '1d 3h');
assert.equal(en('45 ث'), '45s');
assert.equal(en('أقل من ثانية'), '<1s');
assert.equal(en('أقل من دقيقة'), '<1m');
assert.equal(en('—'), '—');
assert.equal(en('8m 3s'), '8m 3s', 'already English stays');
assert.equal(en('الوسيط 3 د 34 ث'), 'الوسيط 3m 34s', 'surrounding Arabic words are kept');
assert.equal(en('5 دقيقة'), '5 دقيقة', 'full Arabic words are not touched');
assert.equal(wait(8 * 60000), '8m'); assert.equal(wait(2 * 3600000 + 5 * 60000), '2h 5m'); assert.equal(wait(90000000), '1d 1h'); assert.equal(wait(30000), '<1m'); assert.equal(wait(null), '—');
// no Arabic duration units are left in the KPI render code
for (const bad of ["' س'", "' د'", "' ث'", "' يوم'"]) assert.ok(!src.slice(src.indexOf('function waKpiWaitDur'), src.indexOf('function waKpiVs')).includes(bad), 'no ' + bad + ' in waKpiWaitDur');
console.log('PASS wa duration units');
