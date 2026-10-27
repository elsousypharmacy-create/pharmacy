// ==== MODULE 64_call_results: نتايج مكالمات المتابعة (calls.html) بتتشارك بين الموظفين ====
// الشيت بيخزن مفتاح مشفّر للعميل (مش رقمه) + النتيجة + الملاحظة. من غير كلمة سر بقرار د. أحمد.
var CALLS_SHEET = 'نتايج المتابعة';
var CALL_STATUSES_ = { done: 1, noanswer: 1, later: 1, wrong: 1 };

function callsSheet_() { return getOrCreateSheet_(CALLS_SHEET, ['المفتاح', 'الحالة', 'ملاحظة', 'الوقت']); }

function callsGet_() {
  var sh = callsSheet_(), n = sh.getLastRow(), out = {};
  if (n < 2) return { ok: true, calls: out };
  sh.getRange(2, 1, n - 1, 4).getValues().forEach(function (r) {
    if (r[0] && r[1]) out[String(r[0])] = { status: String(r[1]), note: String(r[2] || ''), at: Number(r[3]) || 0 };
  });
  return { ok: true, calls: out };
}

function callsSet_(p) {
  var key = String(p.key || '');
  if (!/^[0-9a-f]{16,64}$/.test(key)) return { ok: false, error: 'مفتاح غلط' };
  var status = String(p.status || '');
  if (status && !CALL_STATUSES_[status]) return { ok: false, error: 'حالة غلط' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = callsSheet_(), n = sh.getLastRow(), row = 0;
    if (n >= 2) {
      var keys = sh.getRange(2, 1, n - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) if (String(keys[i][0]) === key) { row = i + 2; break; }
    }
    if (!status) { if (row) sh.deleteRow(row); return { ok: true }; }
    var vals = [[key, status, String(p.note || '').slice(0, 500), Date.now()]];
    if (row) sh.getRange(row, 1, 1, 4).setValues(vals); else sh.appendRow(vals[0]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
