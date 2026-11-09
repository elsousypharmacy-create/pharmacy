// Read-only NOVA purchasing feed. Owner PIN is verified in doPost; no stock writes.
function novaPurchasingFeed_() {
  var hit = fxCacheGet_('nova_purchasing_feed_v1');
  if (hit) return hit;
  var sheet = SpreadsheetApp.openById(STOCK_SHEET_ID).getSheets()[0];
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'stock-empty' };
  var cols = {}, headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  headers.forEach(function (v, i) { cols[String(v || '').trim().toLowerCase()] = i; });
  if (cols.stock === undefined || cols.code === undefined) return { ok: false, error: 'stock-columns-missing' };
  function num(v) { if (v === null || v === undefined || String(v).trim() === '') return null; var n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; }
  var velocity = null;
  try { velocity = salesVelocity_(); } catch (ignore) {}
  var observedDays = velocity && velocity.files > 0 && velocity.days > 0 ? Number(velocity.days) : 0;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues();
  var items = rows.map(function (r) {
    function value(k) { return cols[k] === undefined ? '' : r[cols[k]]; }
    var code = String(value('code') || '').trim(), ar = String(value('namear') || '').trim(), en = String(value('nameen') || '').trim();
    if (!code || (!ar && !en)) return null;
    var sold = null;
    try { var v = observedDays ? velLookup_(velocity, ar || en) : null; if (v && v.length) sold = num(v[0]); } catch (ignore2) {}
    return { id: String(value('id') || code), code: code, gtin: String(value('gtin') || '').trim(), name: ar || en, nameEn: en,
      stock: num(value('stock')), minStock: num(value('minstock')), idealStock: num(value('defaultstock')),
      unit: 'pack', units: num(value('units')), publicPrice: num(value('price')), lastSoldAt: String(value('lastselleddate') || ''),
      dailySales: sold === null || !observedDays ? null : Math.max(0, sold) / observedDays, observedDays: observedDays };
  }).filter(function (x) { return x !== null; });
  var modified = null;
  try { modified = DriveApp.getFileById(STOCK_SHEET_ID).getLastUpdated().toISOString(); } catch (ignore3) {}
  var out = { ok: true, schemaVersion: 1, source: 'STOCK LIVE', sourceUpdatedAt: modified, generatedAt: new Date().toISOString(), observedDays: observedDays, items: items };
  fxCachePut_('nova_purchasing_feed_v1', out, 120);
  return out;
}
