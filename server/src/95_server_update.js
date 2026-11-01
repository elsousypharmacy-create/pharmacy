// ==== MODULE 95_server_update (split from server/Code.js; load order = file name order) ====


/* ═══ 🔄 تحديث السيرفر من زرار في اللوحة ═══
   Claude بيرفع الكود الجديد على Drive بتاعك (ملف خاص — مش على GitHub عشان فيه مفاتيح البوت)،
   والزرار ده بيقراه ويحطه مكان الكود الحالي ويعمل New version على نفس الرابط.
   محتاج مرة واحدة: تشغيل Google Apps Script API من script.google.com/home/usersettings */
var SERVER_SRC_URL = 'https://raw.githubusercontent.com/elsousypharmacy-create/pharmacy/main/server/Code.js';
/* جوجل بتسمح بـ 200 نسخة بس للمشروع، وكل تحديث بيعمل نسخة. لما توصل للحد التحديث بيفشل. */
var SERVER_VERSION_LIMIT_MSG = 'مشروع السيرفر وصل للحد الأقصى (200 نسخة) فجوجل مش هتعمل نسخة جديدة، والتحديث مش هيركب. ' +
  'الحل: افتح script.google.com ← مشروع الصيدلية ← «Project history» (سجل المشروع) ← امسح النسخ القديمة (سيب آخر 20 نسخة) ← وبعدها دوس «حدّث السيرفر» تاني.';
var SERVER_VERSION_MAX = 200, SERVER_VERSION_WARN = 170;
/* عدد النسخ المحفوظة في المشروع (كاش ساعة). -1 = مقدرتش أعدّها. */
function serverVersionCount_(force) {
  var C = CacheService.getScriptCache();
  if (!force) { try { var h = C.get('srv_ver_cnt'); if (h) return parseInt(h, 10); } catch (e0) {} }
  try {
    var H = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, id = ScriptApp.getScriptId(), n = 0, tok = '';
    for (var i = 0; i < 6; i++) {
      var r = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + id + '/versions?pageSize=50' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { headers: H, muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) return -1;
      var j = JSON.parse(r.getContentText());
      n += (j.versions || []).length; tok = j.nextPageToken || '';
      if (!tok) break;
    }
    try { C.put('srv_ver_cnt', String(n), 3600); } catch (e2) {}
    return n;
  } catch (e) { return -1; }
}
/* تنبيه على تيليجرام مرة كل ٢٤ ساعة لما النسخ تقرب تخلص، قبل ما التحديث يفشل */
function warnVersionsIfNeeded_() {
  var n = serverVersionCount_(), P = PropertiesService.getScriptProperties();
  if (n < SERVER_VERSION_WARN) return;
  var last = parseInt(P.getProperty('SERVER_VER_WARNED') || '0', 10);
  if (Date.now() - last < 24 * 3600000) return;
  P.setProperty('SERVER_VER_WARNED', String(Date.now()));
  sendTelegramStaff('⚠️ نسخ السيرفر ' + n + ' من ' + SERVER_VERSION_MAX + ' — قربت تخلص. امسح القديم من script.google.com ← المشروع ← Project history (سيب آخر 20)، وإلا التحديث هيفشل.', PERSONAL_CHAT);
}
function serverSrc_() {
  var r = UrlFetchApp.fetch(SERVER_SRC_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  var src = r.getContentText('UTF-8');
  var sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, src, Utilities.Charset.UTF_8));
  return { src: src, sig: sig };
}
function serverUpdateInfo() {
  /* الكود كبير (≈٦٠٠ ك) فمش بنجيبه من GitHub في كل فتحة للرئيسية — كاش دقيقتين */
  var C = CacheService.getScriptCache();
  try { var hit = C.get('srv_upd_info'); if (hit) return JSON.parse(hit); } catch (eC) {}
  var s = serverSrc_(), P = PropertiesService.getScriptProperties();
  var out = { ok: true, available: !!s, newer: !!s && P.getProperty('SERVER_SRC_SIG') !== s.sig,
              lastUpdate: P.getProperty('SERVER_UPDATED_AT') || '', autoOn: autoUpdateOn_(),
              versions: serverVersionCount_(), versionsMax: SERVER_VERSION_MAX };
  try { C.put('srv_upd_info', JSON.stringify(out), 120); } catch (eP) {}
  return out;
}
/* 🔁 التحديث التلقائي: كل 15 دقيقة يشوف GitHub — لو فيه نسخة جديدة يركّبها ويبعتلك على تيليجرام */
function autoUpdateOn_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'autoServerUpdate'; });
}
function setAutoUpdate(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'autoServerUpdate') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('autoServerUpdate').timeBased().everyMinutes(15).create();
  return { ok: true, autoOn: !!on };
}
function autoServerUpdate() {
  try { maybeEnsureTriggers_(); } catch (eT) {}
  try { warnVersionsIfNeeded_(); } catch (eW) {}
  var s = serverSrc_(), P = PropertiesService.getScriptProperties();
  if (!s || P.getProperty('SERVER_SRC_SIG') === s.sig) { if (s) P.deleteProperty('SERVER_PEND_SIG'); return; }
  if (P.getProperty('SERVER_FAILED_SIG') === s.sig) return;          /* النسخة دي فشلت قبل كده — منحاولش كل ربع ساعة */
  /* 🔗 تجميع: كل تحديث بياكل نسخة من الـ 200، فلو الكود لسه بيتعدّل منركّبش غير لما يثبت ١٠ دقايق */
  if (P.getProperty('SERVER_PEND_SIG') !== s.sig) {
    P.setProperty('SERVER_PEND_SIG', s.sig); P.setProperty('SERVER_PEND_AT', String(Date.now())); return;
  }
  if (Date.now() - parseInt(P.getProperty('SERVER_PEND_AT') || '0', 10) < 10 * 60000) return;
  var r = serverUpdate();
  if (r && r.ok) {
    P.deleteProperty('SERVER_FAILED_SIG');
    sendTelegramStaff('🔄 السيرفر اتحدّث تلقائي — نسخة ' + r.version + ' (' + r.at + ')', PERSONAL_CHAT);
  } else if (r && r.limit) {
    /* مش بنعلّم النسخة كفاشلة — هنحاول تاني كل ربع ساعة لحد ما تمسح نسخ قديمة. التنبيه مرة كل ١٢ ساعة بس. */
    var lastN = parseInt(P.getProperty('SERVER_LIMIT_NOTIFIED') || '0', 10);
    if (Date.now() - lastN > 12 * 3600000) {
      P.setProperty('SERVER_LIMIT_NOTIFIED', String(Date.now()));
      sendTelegramStaff('⚠️ ' + r.error, PERSONAL_CHAT);
    }
  } else {
    P.setProperty('SERVER_FAILED_SIG', s.sig);
    sendTelegramStaff('⚠️ التحديث التلقائي للسيرفر فشل:\n' + ((r && r.error) || 'سبب مش معروف') + '\nالنسخة الحالية شغالة عادي.', PERSONAL_CHAT);
  }
}
function serverUpdate() {
  var s = serverSrc_();
  if (!s) return { ok: false, error: 'مقدرتش أوصل للكود الجديد على GitHub' };
  var src = s.src;
  /* فحص أمان: الكود لازم يكون كامل قبل ما نحطه */
  if (src.length < 100000 || src.indexOf('function doGet(') === -1 || src.indexOf('function doPost(') === -1 || src.indexOf('function serverUpdate(') === -1)
    return { ok: false, error: 'الكود على GitHub ناقص أو مش سليم — مش هحدّث' };
  /* المفاتيح لازم تكون متخزنة قبل ما نحط نسخة من غير مفاتيح */
  var P0 = PropertiesService.getScriptProperties();
  if (!P0.getProperty('BOT_TOKEN') || !P0.getProperty('GEMINI_API_KEY')) return { ok: false, error: 'المفاتيح مش متخزنة — مش هحدّث' };
  var token = ScriptApp.getOAuthToken(), id = ScriptApp.getScriptId(), H = { Authorization: 'Bearer ' + token };
  var api = 'https://script.googleapis.com/v1/projects/' + id;
  var r = UrlFetchApp.fetch(api + '/content', { headers: H, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) {
    var msg = r.getContentText();
    var em = ''; try { em = JSON.parse(msg).error.message; } catch (e) { em = msg; }
    return { ok: false, error: (/insufficient|scope/i.test(em) ? 'الصلاحيات الجديدة لسه متوافقش عليها — اعمل New version ووافق. ' : '') +
      'Apps Script API ' + r.getResponseCode() + ': ' + String(em).slice(0, 300) };
  }
  var content = JSON.parse(r.getContentText()), done = false;
  (content.files || []).forEach(function (file) {
    if (!done && file.type === 'SERVER_JS' && String(file.source || '').indexOf('function doGet(') !== -1) { file.source = src; done = true; }
  });
  if (!done) return { ok: false, error: 'مش لاقي ملف الكود الأساسي في المشروع' };
  r = UrlFetchApp.fetch(api + '/content', { method: 'put', contentType: 'application/json', headers: H, muteHttpExceptions: true,
    payload: JSON.stringify({ files: content.files }) });
  if (r.getResponseCode() !== 200) return { ok: false, error: 'حفظ الكود: ' + r.getContentText().slice(0, 200) };
  var stamp = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm');
  r = UrlFetchApp.fetch(api + '/versions', { method: 'post', contentType: 'application/json', headers: H, muteHttpExceptions: true,
    payload: JSON.stringify({ description: 'تحديث من اللوحة ' + stamp }) });
  if (r.getResponseCode() !== 200) {
    var vtxt = r.getContentText();
    if (r.getResponseCode() === 429 || /limit of \d+ versions/i.test(vtxt))
      return { ok: false, limit: true, error: SERVER_VERSION_LIMIT_MSG };
    return { ok: false, error: 'New version: ' + vtxt.slice(0, 200) };
  }
  var ver = JSON.parse(r.getContentText()).versionNumber;
  var depId = (WEB_APP_URL.match(/\/s\/([^/]+)\/exec/) || [])[1];
  r = UrlFetchApp.fetch(api + '/deployments/' + depId, { method: 'put', contentType: 'application/json', headers: H, muteHttpExceptions: true,
    payload: JSON.stringify({ deploymentConfig: { scriptId: id, versionNumber: ver, manifestFileName: 'appsscript', description: 'تحديث من اللوحة ' + stamp } }) });
  if (r.getResponseCode() !== 200) return { ok: false, error: 'Deploy: ' + r.getContentText().slice(0, 200), version: ver };
  var P = PropertiesService.getScriptProperties();
  P.setProperty('SERVER_SRC_SIG', s.sig);
  P.setProperty('SERVER_UPDATED_AT', stamp);
  try { CacheService.getScriptCache().remove('srv_upd_info'); CacheService.getScriptCache().remove('srv_ver_cnt'); } catch (eR) {}
  try { maybeEnsureTriggers_(); } catch (eT) {}
  return { ok: true, version: ver, at: stamp };
}