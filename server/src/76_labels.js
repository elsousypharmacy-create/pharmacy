// ==== MODULE 76_labels (split from server/Code.js; load order = file name order) ====



// ===================================================================
// 🏷️ ملصقات الأدوية
// الصفحة labels.html بتسأل كل 20 ثانية عن الفواتير الجديدة، الصيدلي يكتب
// العمر/الوزن ويأكد → تتطبع الملصقات. التعليمات اللي الصيدلي بيكتبها بتتحفظ
// وتتعرض اقتراح المرة الجاية لنفس الصنف ونفس الفئة (طفل/كبير).
// الجرعة الأوتوماتيك بتيجي من شيت "Sheet api" لما يبقى فيه تاب "الجرعات".
// ===================================================================

var LABELS_SHEET_API_ID = '1-4GK4K_cCP1p0qZ2KoB0yOWV0-WpNJYPvpaoMw7ypuI';
var LABELS_INSTR_SHEET  = 'تعليمات الملصقات';
var LABELS_LOG_SHEET    = 'سجل الملصقات';
var LABELS_NONDRUG_SHEET = 'أصناف مش أدوية';

/* الأصناف اللي اتأكد إنها مش أدوية (الـ AI قال كده والصيدلي ساب علامتها مشالة) */
function labelsNonDrug_() {
  var hit = fxCacheGet_('fx_lbl_nd');
  if (hit) return hit;
  var m = {};
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(LABELS_NONDRUG_SHEET);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) { if (r[0]) m[r[0]] = 1; });
  } catch (e) {}
  fxCachePut_('fx_lbl_nd', m, 600);
  return m;
}

/* أصناف واضح من اسمها إنها مش أدوية (حفاضات، شامبو، فوط…) — من غير ما نستنى الذكاء الاصطناعي */
var NONDRUG_RX_ = new RegExp('(حفاض|بامبرز|PAMPERS|MOLFIX|DIAPER|شامبو|SHAMPOO|بلسم|CONDITIONER|صابون|SOAP|' +
  'فوط|PADS|ALWAYS|مناديل|WIPES|TISSUE|معجون اسنان|معجون أسنان|TOOTHPASTE|فرشا|TOOTHBRUSH|سرنج|SYRINGE|' +
  'قطن|COTTON|شاش|GAUZE|بلاستر|PLASTER|جوانتي|GLOVE|كمام|FACE MASK|ترمومتر|THERMOMETER|ببرون|سكات|PACIFIER|' +
  'عازل|CONDOM|DUREX|مزيل عرق|DEODORANT|بارفان|PERFUME|برفان|صبغ|HAIR COLOR|ريموفر|REMOVER|مرطب شفايف|LIP BALM|' +
  'شنطه|شنطة|جل شعر|HAIR GEL|زيت شعر|HAIR OIL|سيروم شعر|بودره اطفال|بودرة أطفال|BABY POWDER)', 'i');
function nonDrugByName_(name) { return NONDRUG_RX_.test(String(name || '')); }

function labelsKey_(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9؀-ۿ]+/g, ' ').trim();
}

/* التعليمات المحفوظة: key|band → {text, n} */
function labelsInstrMap_() {
  var hit = fxCacheGet_('fx_lbl_instr');
  if (hit) return hit;
  var map = {};
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(LABELS_INSTR_SHEET);
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues().forEach(function (r) {
        map[r[0] + '|' + r[1]] = { text: r[2], n: parseInt(r[3], 10) || 1 };
      });
    }
  } catch (e) {}
  fxCachePut_('fx_lbl_instr', map, 600);
  return map;
}

/* المادة الفعالة من قاعدة الأدوية (بالاسم الإنجليزي) */
function labelsDrugDb_() {
  var hit = fxCacheGet_('fx_lbl_db');
  if (hit) return hit;
  var db = {};
  try {
    var ss = SpreadsheetApp.openById(LABELS_SHEET_API_ID);
    var sh = ss.getSheetByName('قاعدة الأدوية');
    if (sh && sh.getLastRow() > 1) {
      var v = sh.getDataRange().getDisplayValues(), h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
      var cn = h.indexOf('nameen'), ca = h.indexOf('active_ingredient_en');
      for (var i = 1; i < v.length; i++) if (v[i][cn]) db[labelsKey_(v[i][cn])] = { active: v[i][ca] || '' };
    }
  } catch (e) {}
  fxCachePut_('fx_lbl_db', db, 1800);
  return db;
}

function labelsDone_() {
  var done = {};
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(LABELS_LOG_SHEET);
    if (sh && sh.getLastRow() > 1) {
      var n = Math.min(sh.getLastRow() - 1, 400);
      sh.getRange(sh.getLastRow() - n + 1, 1, n, 1).getDisplayValues().forEach(function (r) { done[String(r[0])] = 1; });
    }
  } catch (e) {}
  return done;
}

/* الفواتير الجديدة النهارده — since = آخر رقم فاتورة الصفحة شافته */
function labelsFeed(since) {
  try {
    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var d = getDayInvoices(today);
    if (!d || !d.ok) return { ok: false, error: (d && d.error) || 'مفيش فواتير' };
    var all = [];
    Object.keys(d.employees || {}).forEach(function (emp) {
      (d.employees[emp] || []).forEach(function (inv) { inv.employee = emp; all.push(inv); });
    });
    all.sort(function (a, b) { return parseInt(b.invoiceid, 10) - parseInt(a.invoiceid, 10); });
    var maxId = all.length ? parseInt(all[0].invoiceid, 10) : 0;
    since = parseInt(since, 10) || 0;

    var instr = labelsInstrMap_(), db = labelsDrugDb_(), done = labelsDone_(), nd = labelsNonDrug_();
    var list = all.slice(0, 40).map(function (inv) {
      var seen = {};
      var items = (inv.items || []).filter(function (it) {
        var k = labelsKey_(it.name); if (seen[k]) return false; seen[k] = 1; return true;
      }).map(function (it) {
        var k = labelsKey_(it.name);
        return { name: it.name, qty: it.qty, key: k, nondrug: !!nd[k] || nonDrugByName_(it.name),
                 active: (db[k] && db[k].active) || '',
                 adult: (instr[k + '|adult'] || {}).text || '',
                 child: (instr[k + '|child'] || {}).text || '' };
      });
      return { id: String(inv.invoiceid), cust: inv.custname || '', phone: inv.phone || '',
               employee: inv.employee || '', total: inv.total || 0, items: items,
               isNew: parseInt(inv.invoiceid, 10) > since, done: !!done[String(inv.invoiceid)],
               hasDrug: items.some(function (x) { return !x.nondrug; }) };
    });
    return { ok: true, maxId: maxId, invoices: list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* حفظ التعليمات + تسجيل إن الفاتورة اتطبعت/اتخطت */
function labelsSave(payload) {
  try {
    var p = JSON.parse(payload || '{}');
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var log = getOrCreateSheet_(LABELS_LOG_SHEET, ['الفاتورة', 'الوقت', 'الحالة', 'العمر', 'الوزن', 'حمل/رضاعة', 'الملصقات']);
    log.appendRow([String(p.id || ''), Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'),
                   p.skip ? 'اتخطت' : 'اتطبعت', p.age || '', p.weight || '', p.preg || '',
                   (p.items || []).map(function (x) { return x.name + ': ' + x.text; }).join(' | ')]);

    if (p.nondrug && p.nondrug.length) {
      var nsh = getOrCreateSheet_(LABELS_NONDRUG_SHEET, ['الصنف', 'أُضيف']);
      var have = labelsNonDrug_(), today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
      p.nondrug.forEach(function (n) { var k = labelsKey_(n); if (k && !have[k]) { nsh.appendRow([k, today]); have[k] = 1; } });
      fxClearCache_('fx_lbl_nd');
    }
    if (!p.skip && p.items && p.items.length) {
      var band = p.band === 'child' ? 'child' : 'adult';
      var sh = getOrCreateSheet_(LABELS_INSTR_SHEET, ['الصنف', 'الفئة', 'التعليمات', 'مرات', 'آخر تعديل']);
      var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues() : [];
      var rowOf = {};
      rows.forEach(function (r, i) { rowOf[r[0] + '|' + r[1]] = { row: i + 2, n: parseInt(r[3], 10) || 0 }; });
      var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
      p.items.forEach(function (it) {
        var k = labelsKey_(it.name), t = String(it.text || '').trim();
        if (!k || !t) return;
        var ex = rowOf[k + '|' + band];
        if (ex) sh.getRange(ex.row, 3, 1, 3).setValues([[t, ex.n + 1, now]]);
        else { sh.appendRow([k, band, t, 1, now]); rowOf[k + '|' + band] = { row: sh.getLastRow(), n: 1 }; }
      });
      fxClearCache_('fx_lbl_instr');
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}