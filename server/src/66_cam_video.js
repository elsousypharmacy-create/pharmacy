// Manual, PIN-protected capability probe for entrance camera 4 only.
// API keys and SDK stream tokens never leave Script Properties / server memory.
// References: Hikvision TPP HC-Integration; SYSCOM-Labs/API-DOCS
// HIKVISION/HikConnect-Team/llms-full.txt sections 2.12 and 3.2.
// Getting an address is NOT proof of decodable video or of AI accuracy.
function camVideoCode_(r) {
  var code = String(r && r.json && r.json.errorCode || '');
  return /^[a-zA-Z0-9_-]{1,40}$/.test(code) ? code : '';
}
function camVideoFail_(stage, message, r) {
  // Never return upstream messages, request bodies, URLs or caught exceptions.
  var out = { ok: false, stage: stage, error: message, channel: 4 };
  if (r && Number(r.code)) out.http = Number(r.code);
  var code = camVideoCode_(r); if (code) out.providerCode = code;
  return out;
}
function camVideoCamera_(token, serial) {
  // Use the exact recorder + channel mapping; never guess a resource ID or use
  // the first camera returned (a different device may belong to the account).
  for (var page = 1; page <= 10; page++) {
    var r = camPost_('/api/hccgw/resource/v1/areas/cameras/get', {
      pageIndex: page, pageSize: 100, filter: { deviceSerialNo: serial }
    }, token);
    if (!camOk_(r)) return { response: r };
    var data = r.json.data, list = data.camera || data.cameraList || [];
    if (!Array.isArray(list)) return {};
    for (var i = 0; i < list.length; i++) {
      var c = list[i], dev = c.device || {}, info = dev.devInfo || {}, channel = dev.channelInfo || {};
      var sn = String(info.serialNo || c.deviceSerial || c.deviceSerialNo || '');
      var no = Number(channel.no || c.cameraNo || c.channelNo || c.channelID);
      if (sn === serial && no === 4 && c.id) return { id: String(c.id) };
    }
    var total = Number(data.totalCount || data.total || 0);
    if (!list.length || (total > 0 ? page * 100 >= total : list.length < 100)) break;
  }
  return {};
}
function camVideoAddress_(token, serial, camera, protocol) {
  return camPost_('/api/hccgw/video/v1/live/address/get', {
    deviceSerial: serial, resourceId: camera, type: '1',
    protocol: protocol, quality: '2', expireTime: 60
  }, token);
}
function camVideoUrl_(r) {
  if (!camOk_(r)) return '';
  var d = r.json.data;
  return String(d.playUrl || d.url || '');
}
function camVideoTest() {
  var stage = 'auth';
  try {
    var tk = camToken_();
    if (tk.error || !tk.token) return camVideoFail_(stage, 'تعذر الدخول لخدمة الكاميرات؛ راجع حالة الربط');
    var serial = PropertiesService.getScriptProperties().getProperty('CAM_DEVICE_SERIAL') || 'E10261949';
    stage = 'camera';
    var camera = camVideoCamera_(tk.token, serial);
    if (!camera.id) return camVideoFail_(stage, 'كاميرا المدخل 4 مش ظاهرة في قائمة الفيديو؛ راجع صلاحية الكاميرا على حساب Hikvision', camera.response);
    stage = 'hls';
    var hls = camVideoAddress_(tk.token, serial, camera.id, 2), url = camVideoUrl_(hls);
    if (/^https:\/\/[^\s<>"']+$/i.test(url)) {
      // The short-lived signed playback URL is returned ONLY to the owner via
      // authenticated POST, never persisted, logged, cached or shared.
      return { ok: true, stage: 'address', channel: 4, mode: 'hls', url: url,
        seconds: 60, quality: 'fluent', message: 'عنوان البث الخفيف متاح؛ التشغيل الفعلي لسه محتاج اختبار' };
    }
    stage = 'ezopen';
    var ez = camVideoAddress_(tk.token, serial, camera.id, 1), ezUrl = camVideoUrl_(ez);
    if (/^ezopen:\/\//i.test(ezUrl)) {
      return { ok: true, stage: 'sdk_required', channel: 4, mode: 'ezopen',
        message: 'عنوان الفيديو الخاص بـ Hikvision متاح، لكن العرض والتحليل محتاجين مشغل Hikvision؛ مفيش فيديو اتشغّل في الاختبار ده',
        hlsCode: camVideoCode_(hls) };
    }
    return camVideoFail_(stage, 'مقدرناش نحصل على عنوان فيديو قابل للاختبار؛ ده مش دليل إن الجهاز مابيدعمش الفيديو', ez);
  } catch (e) {
    return camVideoFail_(stage, 'تعذر إكمال اختبار الفيديو؛ جرّب تاني أو راجع ربط Hikvision');
  }
}
