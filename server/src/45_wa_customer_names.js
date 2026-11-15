// ==== MODULE 45_wa_customer_names (read-only; order = server/files.json) ====
/* ربط أرقام واتساب بقاعدة عملاء الصيدلية (شيت Customers).
   شات واتساب معرّفه wa_<رقم الموبايل>. الاسم كان بيتقرا بس من «الرقم المؤكد» (زرار شارك رقمي بتاع تيليجرام)، وده مبيتحطش لواتساب،
   فكل الأرقام كانت بتظهر أرقام. دلوقتي الرقم نفسه (من المعرّف) بيتدوّر عليه في الشيت. قراءة فقط: مفيش كتابة في الشيتات ولا إرسال. */
function waChatPhone_(chatId) {
  var m = /^wa_(.+)$/.exec(String(chatId || ''));
  if (!m) return '';
  var raw = m[1];
  if (!/^\+?\d[\d\s-]{8,}$/.test(raw)) return '';          /* BSUID زي US.1349… مش رقم */
  var p = canonicalEgyptPhone_(raw);
  return /^01[0125]\d{8}$/.test(p) ? p : '';                /* بس أرقام الموبايل المصرية */
}
/* خريطة رقم مصري موحّد → اسم العميل، من شيت Customers. بتتخزّن 10 دقايق (ومبتتخزنش لو فاضية عشان عطل مؤقت ميثبتش). */
function customerNameMap_() {
  var hit = fxCacheGet_('fx_wa_cnames');
  if (hit) return hit;
  var map = {}, n = 0;
  try {
    var sheet = SpreadsheetApp.openById(CRM_SHEET_ID).getSheetByName('Customers');
    if (sheet && sheet.getLastRow() > 1) {
      var hm = getHeaderMap(sheet);
      if (hm['phone'] !== undefined && hm['name'] !== undefined) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues().forEach(function (r) {
          var p = canonicalEgyptPhone_(r[hm['phone']]), nm = String(r[hm['name']] || '').trim();
          if (p && nm) { map[p] = nm; n++; }
        });
      }
    }
  } catch (e) { return {}; }
  if (n) fxCachePut_('fx_wa_cnames', map, 600);
  return map;
}
function waCustomerName_(chatId) {
  var p = waChatPhone_(chatId);
  return p ? (customerNameMap_()[p] || '') : '';
}
