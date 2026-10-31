// ==== MODULE 66_cameras — ربط الكاميرات (المفاتيح بتتحفظ في Script Properties بس، وعمرها ما بترجع للوحة) ====
var CAM_TYPES_ = { hik: 'Hik-Connect / Hik-Partner OpenAPI', grok: 'API بتاع Grok', dvr: 'جهاز التسجيل مباشرة (IP)', other: 'تاني' };
function camInfo() {
  var P = PropertiesService.getScriptProperties(), url = P.getProperty('CAM_API_URL') || '', host = '';
  try { host = url ? url.replace(/^https?:\/\//, '').split(/[\/?#]/)[0] : ''; } catch (e) {}
  return { ok: true, hasKey: !!P.getProperty('CAM_API_KEY'), hasSecret: !!P.getProperty('CAM_API_SECRET'),
           type: P.getProperty('CAM_API_TYPE') || '', typeName: CAM_TYPES_[P.getProperty('CAM_API_TYPE')] || '',
           host: host, note: P.getProperty('CAM_API_NOTE') || '', savedAt: P.getProperty('CAM_API_AT') || '' };
}
function setCamConfig(d) {
  var P = PropertiesService.getScriptProperties();
  var key = String(d.key || '').trim(), sec = String(d.secret || '').trim(), url = String(d.url || '').trim(),
      type = String(d.type || '').trim(), note = String(d.note || '').trim().slice(0, 200);
  if (type && !CAM_TYPES_[type]) return { ok: false, error: 'نوع غلط' };
  if (key && (key.length < 6 || key.length > 4000)) return { ok: false, error: 'المفتاح شكله غلط' };
  if (sec && sec.length > 4000) return { ok: false, error: 'الـ Secret طويل زيادة' };
  if (url && !/^(https?:\/\/)?[\w.-]+(:\d+)?(\/.*)?$/i.test(url)) return { ok: false, error: 'الرابط شكله غلط' };
  if (!key && !sec && !url && !type && !note) return { ok: false, error: 'مفيش حاجة تتحفظ' };
  if (key) P.setProperty('CAM_API_KEY', key);
  if (sec) P.setProperty('CAM_API_SECRET', sec);
  if (url) P.setProperty('CAM_API_URL', url);
  if (type) P.setProperty('CAM_API_TYPE', type);
  if (note) P.setProperty('CAM_API_NOTE', note);
  P.setProperty('CAM_API_AT', Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'));
  return { ok: true };
}
