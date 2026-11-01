// ==== MODULE 68_balance — الميزانية: اللي ليك واللي عليك (أرقام نظام البيع + أرقام بتدخلها إنت) ====
/* الأرقام التلقائية بتيجي من تقرير النظام اليومي (Daily_Mini_Statics) — نفس الملف اللي بتقراه باقي اللوحة:
     ليك:  كل الدين (ديون العملاء) + المخزون بالتكلفة
     عليك: «مطالبة اليوم» لكل شركة + أرصدة العملاء الدائنة (كل الدين − صافي الدين) + عمولات المندوبين
   والأرقام اللي النظام مايعرفهاش (كاش، بنك، مرتبات، أي حاجة تانية) بتدخلها إنت ومتخزنة في Script Properties. */
var BS_KEYS_ = ['cash', 'bank', 'salaries', 'other_assets', 'other_liabs'];
function bsNum_(v) {
  var s = String(v == null ? '' : v).replace(/[٠-٩]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); }).replace(/[,\s]/g, '');
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function bsRead_(k) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(k) || 'null'); } catch (e) { return null; }
}
function getBalanceSheet() {
  try {
    var data = SpreadsheetApp.openById(DAILY_STATS_SHEET_ID).getSheets()[0].getDataRange().getValues();
    var map = {}, claims = [];
    data.forEach(function (r) {
      if (!r[0]) return;
      var k = String(r[0]).trim(); map[k] = r[1];
      var m = /^مطالبة اليوم\s+(.+)$/.exec(k);
      if (m) { var a = Math.round(parseFloat(r[1]) || 0); if (a > 0) claims.push({ name: m[1].trim(), amount: a }); }
    });
    claims.sort(function (a, b) { return b.amount - a.amount; });
    var n = function (k) { return parseFloat(map[k]) || 0; };
    var receivable = Math.round(n('كل الدين')), netDebt = Math.round(n('صافي الدين'));
    var custCredit = Math.max(0, receivable - netDebt);
    var invCost = Math.round(n('اجمالى المخزون تكلفة')), invRetail = Math.round(n('اجمالى المخزون جمهور'));
    var incoming = Math.round(n('تكلفة الطلبيات تحت الاستلام'));
    var claimsTotal = claims.reduce(function (s, c) { return s + c.amount; }, 0);
    var agentsDue = 0;
    try { ((getAgentsSnap() || {}).agents || []).forEach(function (a) { if (a.balance > 0) agentsDue += a.balance; }); } catch (eA) {}
    agentsDue = Math.round(agentsDue);

    var inp = bsRead_('BS_INPUT') || {};
    var v = function (k) { return (inp[k] === undefined || inp[k] === null) ? null : inp[k]; };
    var missing = [];
    if (v('cash') === null) missing.push('الكاش');
    if (v('bank') === null) missing.push('البنك');
    if (v('salaries') === null) missing.push('المرتبات');

    var assets = [
      { k: 'receivable', label: 'ديون العملاء', amount: receivable, sub: 'كل الدين على العملاء (صافي الدين ' + netDebt + ')' },
      { k: 'inventory', label: 'المخزون بالتكلفة', amount: invCost, sub: 'بسعر الجمهور ' + invRetail },
      { k: 'cash', label: 'الكاش (خزنة + درج)', amount: v('cash'), manual: true },
      { k: 'bank', label: 'البنك / الكروت', amount: v('bank'), manual: true },
      { k: 'other_assets', label: 'أصول تانية', amount: v('other_assets'), manual: true, optional: true }
    ];
    var liabs = [
      { k: 'claims', label: 'مطالبات الشركات', amount: claimsTotal, sub: claims.slice(0, 3).map(function (c) { return c.name + ' ' + c.amount; }).join(' · ') },
      { k: 'cust_credit', label: 'أرصدة دائنة للعملاء', amount: custCredit, sub: 'كل الدين − صافي الدين' },
      { k: 'agents', label: 'عمولات المندوبين', amount: agentsDue },
      { k: 'salaries', label: 'مرتبات مستحقة', amount: v('salaries'), manual: true },
      { k: 'other_liabs', label: 'التزامات تانية', amount: v('other_liabs'), manual: true, optional: true }
    ];
    var sum = function (l) { return l.reduce(function (s, x) { return s + (x.amount || 0); }, 0); };
    var aT = Math.round(sum(assets)), lT = Math.round(sum(liabs)), net = aT - lT;
    var base = bsRead_('BS_BASE');
    return {
      ok: true, as_of: String(map['الوقت'] || ''), assets: assets, liabs: liabs,
      assets_total: aT, liabs_total: lT, net: net, missing: missing,
      claims: claims, incoming_cost: incoming,
      inputs: { cash: v('cash'), bank: v('bank'), salaries: v('salaries'), other_assets: v('other_assets'), other_liabs: v('other_liabs'), at: inp.at || '' },
      base: base || null, delta: base ? net - base.net : null
    };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
/* الأرقام اللي بتدخلها إنت. حقل فاضي = يتمسح. */
function setBalanceInputs(p) {
  try {
    p = p || {};
    var cur = bsRead_('BS_INPUT') || {};
    for (var i = 0; i < BS_KEYS_.length; i++) {
      var k = BS_KEYS_[i];
      if (p[k] === undefined) continue;
      if (String(p[k]).trim() === '') { delete cur[k]; continue; }
      var x = bsNum_(p[k]);
      if (x === null) return { ok: false, error: 'رقم غلط في ' + k };
      cur[k] = x;
    }
    cur.at = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm');
    PropertiesService.getScriptProperties().setProperty('BS_INPUT', JSON.stringify(cur));
    return getBalanceSheet();
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
/* بيحفظ الميزانية الحالية كنقطة بداية (مثلًا أول الشهر) عشان تتقارن بيها */
function setBalanceBase(p) {
  try {
    var b = getBalanceSheet(); if (!b.ok) return b;
    var label = String((p && p.label) || '').trim().slice(0, 40) || 'بداية الفترة';
    PropertiesService.getScriptProperties().setProperty('BS_BASE', JSON.stringify({
      label: label, date: Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd'),
      assets: b.assets_total, liabs: b.liabs_total, net: b.net, missing: b.missing
    }));
    return getBalanceSheet();
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
