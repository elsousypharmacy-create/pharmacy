// One manual sample, bounded to 20-30 media seconds / 8 MiB / 45s polling.
// Archive contains local media names ONLY: never provider URLs, tokens or keys.
// HLS format: RFC 8216. Encrypted/ranged/discontinuous streams fail closed.
function camRecError_(code) { var e = new Error('camera sample'); e.camCode = code; throw e; }
function camRecUrl_(base, relative) {
  var m = /^(https:\/\/([a-z0-9.-]+))(?::443)?(\/[^?#]*)?(\?[^#]*)?$/i.exec(base);
  if (!m || !m[2].includes('.') || /(^|\.)(localhost|local|internal)$|^[\d.]+$/i.test(m[2])) camRecError_('url');
  var origin = m[1], value = String(relative || '').trim();
  if (!value || /[\s\\<>"'#]/.test(value)) camRecError_('url');
  if (/^https:\/\//i.test(value)) {
    if (value.slice(0, origin.length).toLowerCase() !== origin.toLowerCase() || !/^[/?]/.test(value.slice(origin.length))) camRecError_('origin');
    return value;
  }
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) camRecError_('origin');
  if (value[0] === '?') return origin + (m[3] || '/') + value;
  var path = value[0] === '/' ? value : (m[3] || '/').replace(/[^/]*$/, '') + value;
  var parts = path.split('?'), normalized = [];
  parts[0].split('/').forEach(function(p) { if (p === '..') normalized.pop(); else if (p && p !== '.') normalized.push(p); });
  return origin + '/' + normalized.join('/') + (parts.length > 1 ? '?' + parts.slice(1).join('?') : '');
}
function camRecFetch_(url, text) {
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: false });
  if (r.getResponseCode() !== 200) camRecError_('fetch');
  if (text) { var s = r.getContentText(); if (s.length > 150000) camRecError_('playlist_size'); return s; }
  return r.getBlob();
}
function camRecParse_(text) {
  if (!/^\s*#EXTM3U/.test(text)) camRecError_('playlist');
  if (/#EXT-X-(BYTERANGE|DISCONTINUITY|GAP|I-FRAMES-ONLY|SESSION-KEY)/.test(text)) camRecError_('format');
  var lines = text.trim().split(/\r?\n/), result = { segments: [], variants: [], map: '', sequence: 0 }, duration = null, variant = null;
  lines.forEach(function(raw) {
    var line = raw.trim(), m;
    if (!line) return;
    if (/^#EXT-X-KEY:/.test(line) && !/^#EXT-X-KEY:METHOD=NONE\s*$/.test(line)) camRecError_('encrypted');
    if ((m = /^#EXT-X-MAP:URI="([^"]+)"\s*$/.exec(line))) { if (result.map && result.map !== m[1]) camRecError_('format'); result.map = m[1]; }
    else if (/^#EXT-X-MAP:/.test(line)) camRecError_('format');
    if ((m = /^#EXT-X-MEDIA-SEQUENCE:(\d+)$/.exec(line))) result.sequence = Number(m[1]);
    if ((m = /^#EXTINF:([\d.]+)/.exec(line))) { duration = Number(m[1]); if (!(duration > 0 && duration <= 10)) camRecError_('duration'); }
    if (/^#EXT-X-STREAM-INF:/.test(line)) { m = /(?:[:,])BANDWIDTH=(\d+)/.exec(line); variant = m ? Number(m[1]) : Infinity; }
    if (line[0] !== '#') {
      if (variant !== null) { result.variants.push({ uri: line, bandwidth: variant }); variant = null; }
      else if (duration !== null) { result.segments.push({ uri: line, seconds: duration, sequence: result.sequence + result.segments.length }); duration = null; }
      else camRecError_('format');
    }
  });
  return result;
}
function camRecFolder_() {
  var P = PropertiesService.getScriptProperties(), id = P.getProperty('CAM_SAMPLE_FOLDER');
  var folder = id ? DriveApp.getFolderById(id) : DriveApp.createFolder('عينات فيديو الكاميرات — خاص');
  // Separate root folder, never inherit sharing from snapshot/report folders.
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE || folder.getEditors().length || folder.getViewers().length) camRecError_('privacy');
  if (!id) P.setProperty('CAM_SAMPLE_FOLDER', folder.getId());
  return folder;
}
function camRecordSample(request) {
  var channel = request && request.channel;
  if (channel !== 3 && channel !== 4) return { ok: false, stage: 'channel', error: 'اختار المدخل 4 أو الكاشير 3' };
  var lock = LockService.getScriptLock(), locked = false, stage = 'lock';
  try {
    locked = lock.tryLock(1000);
    if (!locked) return { ok: false, stage: 'busy', error: 'في تسجيل أو عملية تانية شغالة؛ استنى وجرّب تاني' };
    stage = 'privacy'; var folder = camRecFolder_();
    stage = 'address'; var live = camVideoTest({ channel: channel });
    if (!live.ok || live.mode !== 'hls') return { ok: false, stage: 'address', error: 'عنوان HLS مش متاح للتسجيل دلوقتي' };
    var url = camRecUrl_(live.url, live.url), start = Date.now(), deadline = start + 45000;
    stage = 'playlist'; var list = camRecParse_(camRecFetch_(url, true));
    if (list.variants.length) {
      list.variants.sort(function(a,b) { return a.bandwidth - b.bandwidth; });
      url = camRecUrl_(url, list.variants[0].uri);
      list = camRecParse_(camRecFetch_(url, true));
    }
    if (!list.segments.length || list.variants.length) camRecError_('playlist');
    var blobs = [], local = [], total = 0, bytes = 0, next = list.segments[list.segments.length - 1].sequence, init = '';
    function add(blob, name) {
      var size = blob.getBytes().length;
      if (!size || bytes + size > 8 * 1024 * 1024) camRecError_('size');
      bytes += size; blobs.push(blob.setName(name));
    }
    stage = 'media';
    if (list.map) { init = camRecUrl_(url, list.map); add(camRecFetch_(init, false), 'init.mp4'); }
    for (var poll = 0; poll < 24 && Date.now() < deadline && total < 20; poll++) {
      if (init !== (list.map ? camRecUrl_(url, list.map) : '')) camRecError_('format');
      for (var i = 0; i < list.segments.length && total < 20; i++) {
        var seg = list.segments[i]; if (seg.sequence < next) continue;
        if (seg.sequence !== next) camRecError_('gap');
        if (Date.now() >= deadline) break;
        var name = 'segment_' + ('000' + local.length).slice(-3) + (init ? '.m4s' : '.ts');
        var blob = camRecFetch_(camRecUrl_(url, seg.uri), false), b = blob.getBytes();
        if (!init && ((b[0] & 255) !== 0x47 || b.length < 188)) camRecError_('container');
        add(blob, name); local.push({ name: name, seconds: seg.seconds }); total += seg.seconds; next++;
      }
      if (total >= 20) break;
      Utilities.sleep(2000);
      list = camRecParse_(camRecFetch_(url, true));
    }
    if (total < 20) camRecError_('short');
    stage = 'save';
    var playlist = '#EXTM3U\n#EXT-X-VERSION:' + (init ? 7 : 3) + '\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n' +
      (init ? '#EXT-X-MAP:URI="init.mp4"\n' : '') + local.map(function(s) { return '#EXTINF:' + s.seconds + ',\n' + s.name; }).join('\n') + '\n#EXT-X-ENDLIST\n';
    var stamp = Utilities.formatDate(new Date(start), 'Africa/Cairo', 'yyyy-MM-dd_HHmmss');
    var meta = { v: 1, channel: channel, requestedAt: new Date(start).toISOString(), savedAt: new Date().toISOString(),
      mediaSeconds: total, mediaBytes: bytes, segments: local.length, quality: 'fluent',
      note: 'Manual short sample; timestamps are server collection times, not verified camera event times. Decode and review before analysis.' };
    blobs.push(Utilities.newBlob(playlist, 'application/vnd.apple.mpegurl', 'sample.m3u8'));
    blobs.push(Utilities.newBlob(JSON.stringify(meta), 'application/json', 'metadata.json'));
    var file = folder.createFile(Utilities.zip(blobs, 'sample_' + stamp + '_ch' + channel + '.zip'));
    if (file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getEditors().length || file.getViewers().length) { file.setTrashed(true); camRecError_('privacy'); }
    return { ok: true, stage: 'saved', channel: channel, id: file.getId(), seconds: total, bytes: file.getSize(),
      message: 'اتحفظت عينة فيديو خاصة؛ لسه محتاجة فك وتجربة تشغيل ومراجعة' };
  } catch (e) {
    return { ok: false, stage: stage, code: /^[a-z_]+$/.test(e.camCode || '') ? e.camCode : 'failed', channel: channel,
      error: 'التسجيل ماكملش؛ مفيش عينة اتأكدت. إعدادات الكاميرا والتشفير ماتغيرتش' };
  } finally { if (locked) lock.releaseLock(); }
}
// Owner editor-only manual pilot. No trigger is installed, no PIN is logged.
function camRecordPilot() {
  [4, 3].forEach(function(channel) { console.log(JSON.stringify(camRecordSample({ channel: channel }))); });
}
