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

// ---- Hik-Connect (HikCentral Connect) OpenAPI — اختبار قراءة بس: توكن + قائمة الأجهزة + لقطة من كل قناة ----
var CAM_DEFAULT_HOST_ = 'https://ieu.hikcentralconnect.com';
function camBase_() {
  var u = String(PropertiesService.getScriptProperties().getProperty('CAM_API_URL') || '').trim();
  if (!u) return CAM_DEFAULT_HOST_;
  u = u.replace(/\/+$/, '');
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}
function camPost_(path, body, token) {
  var h = { 'Content-Type': 'application/json' };
  if (token) h['Token'] = token;
  var r = UrlFetchApp.fetch(camBase_() + path, { method: 'post', contentType: 'application/json', headers: h, payload: JSON.stringify(body || {}), muteHttpExceptions: true });
  var txt = r.getContentText(), j = null;
  try { j = JSON.parse(txt); } catch (e) {}
  return { code: r.getResponseCode(), json: j, text: txt };
}
function camOk_(r) { return r.code === 200 && r.json && (String(r.json.errorCode) === '0' || r.json.errorCode === undefined) && r.json.data; }
function camErr_(r) { return 'HTTP ' + r.code + ' ' + String((r.json && (r.json.message || r.json.errorCode)) || r.text || '').slice(0, 160); }
function camToken_() {
  var P = PropertiesService.getScriptProperties(), tok = P.getProperty('CAM_TOKEN'), exp = Number(P.getProperty('CAM_TOKEN_EXP') || 0);
  if (tok && exp - Date.now() > 3600 * 1000) return { token: tok };
  var k = P.getProperty('CAM_API_KEY'), s = P.getProperty('CAM_API_SECRET');
  if (!k || !s) return { error: 'المفتاح أو الـ Secret مش متحطين' };
  var r = camPost_('/api/hccgw/platform/v1/token/get', { appKey: k, secretKey: s });
  if (!camOk_(r) || !r.json.data.accessToken) return { error: 'التوكن فشل: ' + camErr_(r).replace(k, '***').replace(s, '***') };
  var e = Date.parse(r.json.data.expireTime || '') || (Date.now() + 6 * 24 * 3600 * 1000);
  P.setProperty('CAM_TOKEN', r.json.data.accessToken); P.setProperty('CAM_TOKEN_EXP', String(e));
  return { token: r.json.data.accessToken };
}
function camDevices_(token) {
  var r = camPost_('/api/hccgw/resource/v1/devices/get', { pageIndex: 1, pageSize: 50 }, token);
  if (!camOk_(r)) return { error: 'قائمة الأجهزة فشلت: ' + camErr_(r) };
  var dd = r.json.data, list = dd.list || dd.devices || dd.Device || dd.deviceList || [];
  return { list: list, keys: Object.keys(dd).join(','), total: dd.total };
}
function camTest(d) {
  var tk = camToken_(); if (tk.error) return { ok: false, error: tk.error };
  var dv = camDevices_(tk.token); if (dv.error) return { ok: false, error: dv.error };
  var devs = dv.list.map(function (x) { return { name: x.name || x.deviceName || '', serial: x.deviceSerial || x.serial || x.id || '', online: x.status !== undefined ? x.status : (x.online !== undefined ? x.online : ''), raw: Object.keys(x).slice(0, 12).join(',') }; });
  var serial = String(d.serial || '').trim() || (devs[0] && devs[0].serial) || PropertiesService.getScriptProperties().getProperty('CAM_DEVICE_SERIAL') || 'E10261949';
  var note = devs.length ? '' : 'قائمة الأجهزة فاضية (حقول الرد: ' + dv.keys + ' / total=' + dv.total + ') — جربت الرقم E10261949 مباشرة';
  var it = DriveApp.getFoldersByName('كاميرات الصيدلية'), folder = it.hasNext() ? it.next() : DriveApp.createFolder('كاميرات الصيدلية');
  var stamp = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd_HHmm'), shots = [];
  for (var ch = 1; ch <= 6; ch++) {
    try {
      var r = camPost_('/api/hccgw/resource/v1/device/capturePic', { deviceSerial: serial, channelNo: ch }, tk.token);
      if (!camOk_(r) || !r.json.data.captureUrl) { shots.push({ ch: ch, ok: false, error: camErr_(r) }); continue; }
      var img = UrlFetchApp.fetch(r.json.data.captureUrl, { muteHttpExceptions: true });
      if (img.getResponseCode() !== 200) { shots.push({ ch: ch, ok: false, error: 'تحميل الصورة HTTP ' + img.getResponseCode() }); continue; }
      var f = folder.createFile(img.getBlob().setName('test_' + stamp + '_ch' + ch + '.jpg'));
      shots.push({ ch: ch, ok: true, bytes: f.getSize(), url: f.getUrl() });
    } catch (e) { shots.push({ ch: ch, ok: false, error: String(e).slice(0, 160) }); }
  }
  return { ok: true, serial: serial, note: note, devices: devs, shots: shots, folder: folder.getUrl() };
}
