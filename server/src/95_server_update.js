// ==== MODULE 95_server_update (split from server/Code.js; load order = file name order) ====


/* ═══ 🔄 تحديث السيرفر من زرار في اللوحة ═══
   Claude بيرفع الكود الجديد على Drive بتاعك (ملف خاص — مش على GitHub عشان فيه مفاتيح البوت)،
   والزرار ده بيقراه ويحطه مكان الكود الحالي ويعمل New version على نفس الرابط.
   محتاج مرة واحدة: تشغيل Google Apps Script API من script.google.com/home/usersettings */
var SERVER_SRC_URL = 'https://raw.githubusercontent.com/elsousypharmacy-create/pharmacy/main/server/Code.js';
function serverSrc_() {
  var r = UrlFetchApp.fetch(SERVER_SRC_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  var src = r.getContentText('UTF-8');
  var sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, src, Utilities.Charset.UTF_8));
  return { src: src, sig: sig };
}
/* عدد نسخ المشروع (Apps Script بيقف عند 200 ومفيش API لمسحها). بيتخزّن 5 دقايق. بيرجّع -1 لو معرفناش. */
var SERVER_VERSION_LIMIT_ = 200;
function serverVersionCount_() {
  var c = CacheService.getScriptCache(), k = 'srvver_n', v = c.get(k);
  if (v) return parseInt(v, 10);
  var n = -1;
  try {
    var H = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, tok = '', total = 0, guard = 0;
    do {
      var r = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + '/versions?pageSize=200' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { headers: H, muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) { total = -1; break; }
      var j = JSON.parse(r.getContentText()); total += (j.versions || []).length; tok = j.nextPageToken || '';
    } while (tok && ++guard < 5);
    n = total;
  } catch (e) {}
  try { c.put(k, String(n), 300); } catch (e2) {}
  return n;
}
function serverUpdateInfo() {
  var s = serverSrc_(), P = PropertiesService.getScriptProperties();
  return { ok: true, available: !!s, newer: !!s && P.getProperty('SERVER_SRC_SIG') !== s.sig,
           lastUpdate: P.getProperty('SERVER_UPDATED_AT') || '', autoOn: autoUpdateOn_(),
           versions: serverVersionCount_(), versionLimit: SERVER_VERSION_LIMIT_ };
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
  var s = serverSrc_(), P = PropertiesService.getScriptProperties();
  if (!s || P.getProperty('SERVER_SRC_SIG') === s.sig) return;
  if (P.getProperty('SERVER_FAILED_SIG') === s.sig) return;          /* النسخة دي فشلت قبل كده — منحاولش كل ربع ساعة */
  var r = serverUpdate();
  if (r && r.ok) {
    P.deleteProperty('SERVER_FAILED_SIG');
    sendTelegramStaff('🔄 السيرفر اتحدّث تلقائي — نسخة ' + r.version + ' (' + r.at + ')', PERSONAL_CHAT);
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
      return { ok: false, versionLimit: true, error: 'وصلنا الحد الأقصى لنسخ Apps Script (' + SERVER_VERSION_LIMIT_ + ' نسخة). امسح نسخ قديمة من script.google.com ← المشروع ← Project history (أيقونة الساعة)، وسيب آخر كام نسخة وأي نسخة مربوطة بالـ deployment الحالي، وبعدين جرّب تاني. السيرفر الشغال لسه على نسخته السابقة.' };
    return { ok: false, error: 'New version: ' + vtxt.slice(0, 200) };
  }
  try { CacheService.getScriptCache().remove('srvver_n'); } catch (eV) {}
  var ver = JSON.parse(r.getContentText()).versionNumber;
  var depId = (WEB_APP_URL.match(/\/s\/([^/]+)\/exec/) || [])[1];
  r = UrlFetchApp.fetch(api + '/deployments/' + depId, { method: 'put', contentType: 'application/json', headers: H, muteHttpExceptions: true,
    payload: JSON.stringify({ deploymentConfig: { scriptId: id, versionNumber: ver, manifestFileName: 'appsscript', description: 'تحديث من اللوحة ' + stamp } }) });
  if (r.getResponseCode() !== 200) return { ok: false, error: 'Deploy: ' + r.getContentText().slice(0, 200), version: ver };
  var P = PropertiesService.getScriptProperties();
  P.setProperty('SERVER_SRC_SIG', s.sig);
  P.setProperty('SERVER_UPDATED_AT', stamp);
  try { maybeEnsureTriggers_(); } catch (eT) {}
  return { ok: true, version: ver, at: stamp };
}