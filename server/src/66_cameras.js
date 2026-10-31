// ==== MODULE 66_cameras — ربط الكاميرات (المفاتيح بتتحفظ في Script Properties بس، وعمرها ما بترجع للوحة) ====
var CAM_TYPES_ = { hik: 'Hik-Connect / Hik-Partner OpenAPI', grok: 'API بتاع Grok', dvr: 'جهاز التسجيل مباشرة (IP)', other: 'تاني' };
function camInfo() {
  var P = PropertiesService.getScriptProperties(), url = P.getProperty('CAM_API_URL') || '', host = '';
  try { host = url ? url.replace(/^https?:\/\//, '').split(/[\/?#]/)[0] : ''; } catch (e) {}
  return { ok: true, hasKey: !!P.getProperty('CAM_API_KEY'), hasSecret: !!P.getProperty('CAM_API_SECRET'),
           type: P.getProperty('CAM_API_TYPE') || '', typeName: CAM_TYPES_[P.getProperty('CAM_API_TYPE')] || '',
           host: host, note: P.getProperty('CAM_API_NOTE') || '', savedAt: P.getProperty('CAM_API_AT') || '', lastSnap: P.getProperty('CAM_SNAP_LAST') || '' };
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

// ---- زرار الداشبورد: لقطات الكاميرات دلوقتي → تليجرام (ألبوم واحد) ----
var CAM_NAMES_ = { 1: 'كاميرا 1 — الرصيف (برة)', 2: 'كاميرا 2 — الرفوف', 3: 'كاميرا 3 — المكتب والكاونتر', 4: 'كاميرا 4 — الواجهة الزجاج من جوه', 6: 'كاميرا 6 — الرصيف (برة)' };
function camGrab_(token, serial, ch) {
  var r = camPost_('/api/hccgw/resource/v1/device/capturePic', { deviceSerial: serial, channelNo: ch }, token);
  if (!camOk_(r) || !r.json.data.captureUrl) return { error: camErr_(r) };
  var img = UrlFetchApp.fetch(r.json.data.captureUrl, { muteHttpExceptions: true });
  if (img.getResponseCode() !== 200) return { error: 'تحميل الصورة HTTP ' + img.getResponseCode() };
  return { blob: img.getBlob().setName('cam' + ch + '.jpg') };
}
function camSendTelegram(d) {
  var tk = camToken_(); if (tk.error) return { ok: false, error: tk.error };
  var serial = PropertiesService.getScriptProperties().getProperty('CAM_DEVICE_SERIAL') || 'E10261949';
  var when = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm');
  var media = [], payload = { chat_id: String(PERSONAL_CHAT) }, fails = [];
  [1, 2, 3, 4, 6].forEach(function (ch) {
    var g = camGrab_(tk.token, serial, ch);
    if (g.error) { fails.push('كاميرا ' + ch); return; }
    var k = 'p' + ch; payload[k] = g.blob;
    media.push({ type: 'photo', media: 'attach://' + k, caption: CAM_NAMES_[ch] + ' — ' + when });
  });
  if (!media.length) return { ok: false, error: 'مفيش لقطة اتسحبت' };
  payload.media = JSON.stringify(media);
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMediaGroup', { method: 'post', payload: payload, muteHttpExceptions: true });
  var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (!j.ok) return { ok: false, error: 'تليجرام: ' + String(j.description || r.getResponseCode()).slice(0, 120) };
  return { ok: true, sent: media.length, failed: fails };
}

// ---- سحب تلقائي كل ساعة (8 الصبح → 1 بالليل بتوقيت مصر) على الدرايف: كاميرات الصيدلية / yyyy-MM-dd / HHmm_chN.jpg ----
function camRootFolder_() { var it = DriveApp.getFoldersByName('كاميرات الصيدلية'); return it.hasNext() ? it.next() : DriveApp.createFolder('كاميرات الصيدلية'); }
function camAutoSnap() {
  var hr = Number(Utilities.formatDate(new Date(), 'Africa/Cairo', 'H'));
  if (hr < 8 && hr !== 0) return;   // برة مواعيد الشغل (8 الصبح → 1 بالليل: آخر سحبة 12:50)
  var tk = camToken_(); if (tk.error) { PropertiesService.getScriptProperties().setProperty('CAM_SNAP_LAST', 'فشل: ' + tk.error); return; }
  var serial = PropertiesService.getScriptProperties().getProperty('CAM_DEVICE_SERIAL') || 'E10261949';
  var root = camRootFolder_(), day = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd'), hm = Utilities.formatDate(new Date(), 'Africa/Cairo', 'HHmm');
  var it = root.getFoldersByName(day), dayF = it.hasNext() ? it.next() : root.createFolder(day), ok = 0, bad = [];
  [1, 2, 3, 4, 6].forEach(function (ch) {
    try { var g = camGrab_(tk.token, serial, ch); if (g.error) { bad.push(ch); return; } dayF.createFile(g.blob.setName(hm + '_ch' + ch + '.jpg')); ok++; } catch (e) { bad.push(ch); }
  });
  PropertiesService.getScriptProperties().setProperty('CAM_SNAP_LAST', day + ' ' + hm + ' — ' + ok + '/5' + (bad.length ? ' (فشل: ' + bad.join(',') + ')' : ''));
  // مسح أي فولدر يوم أقدم من 30 يوم (≈ 1.2 جيجا)
  try {
    var lim = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), 'Africa/Cairo', 'yyyy-MM-dd'), fs = root.getFolders();
    while (fs.hasNext()) { var f = fs.next(); if (/^\d{4}-\d{2}-\d{2}$/.test(f.getName()) && f.getName() < lim) f.setTrashed(true); }
  } catch (e2) {}
}
/* تشغيل السحب التلقائي كل 10 دقايق (بيشيل أي تريجر قديم للكاميرات الأول) */
function camAutoOn() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'camAutoSnap') ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger('camAutoSnap').timeBased().everyMinutes(10).create();
    return { ok: true, message: 'السحب التلقائي شغال كل 10 دقايق (8 الصبح → 1 بالليل)' };
  } catch (e) { return { ok: false, error: 'مقدرتش أشغّله: ' + String(e.message || e).slice(0, 160) }; }
}
