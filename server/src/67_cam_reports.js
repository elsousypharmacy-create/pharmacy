// ==== MODULE 67_cam_reports — تقارير الكاميرات (Claude بيكتب ملف JSON صغير، واللوحة بترسم الأسهم على اللقطة الأصلية) ====
// المكان: «كاميرات الصيدلية» / «تقارير» / report_yyyy-MM-dd_HHmm.json
function camReportsFolder_() {
  var root = camRootFolder_(), it = root.getFoldersByName('تقارير');
  return it.hasNext() ? it.next() : root.createFolder('تقارير');
}
function camReports() {
  var c = CacheService.getScriptCache(), hit = c.get('cam_reports_v1');
  if (hit) return JSON.parse(hit);
  var files = camReportsFolder_().getFiles(), list = [];
  while (files.hasNext()) {
    var f = files.next(); if (!/^report_.*\.json$/.test(f.getName())) continue;
    list.push({ f: f, n: f.getName() });
  }
  list.sort(function(a, b){ return a.n < b.n ? 1 : -1; });
  var out = [];
  list.slice(0, 40).forEach(function(x){
    try { var r = JSON.parse(x.f.getBlob().getDataAsString('UTF-8')); r.id = x.f.getId(); out.push(r); } catch (e) {}
  });
  var res = { ok: true, reports: out, total: list.length };
  try { c.put('cam_reports_v1', JSON.stringify(res), 300); } catch (e) {}
  return res;
}
// صورة لقطة واحدة (بس من جوه فولدر الكاميرات — مفيش أي ملف تاني من الدرايف يطلع)
function camFrame(id) {
  try {
    var f = DriveApp.getFileById(String(id || '')), root = camRootFolder_().getId(), ok = false;
    var ps = f.getParents();
    while (ps.hasNext()) {
      var p = ps.next(); if (p.getId() === root) { ok = true; break; }
      var gp = p.getParents(); while (gp.hasNext()) if (gp.next().getId() === root) { ok = true; break; }
      if (ok) break;
    }
    if (!ok || !/^image\//.test(f.getMimeType())) return { ok: false, error: 'الملف ده مش من الكاميرات' };
    return { ok: true, mime: f.getMimeType(), b64: Utilities.base64Encode(f.getBlob().getBytes()) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
// كل لقطات التقرير في طلب واحد (أسرع بكتير من 5 طلبات ورا بعض)
function camFrames(ids) {
  var out = {};
  String(ids || '').split(',').slice(0, 8).forEach(function(id){ id = id.trim(); if (id) out[id] = camFrame(id); });
  return { ok: true, frames: out };
}
