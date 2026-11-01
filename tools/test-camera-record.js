const fs = require('fs'), vm = require('vm'), assert = require('assert');
const root = require('path').join(__dirname, '..');
const source = fs.readFileSync(root + '/server/src/66_cam_record.js', 'utf8');
let tests = 0;
function test(name, fn) { fn(); tests++; console.log('OK', name); }
function setup(options = {}) {
  let now = 0, saved = null, released = 0, requests = 0; const properties = {};
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const blob = (value, type, name) => ({ value, name, getBytes: () => typeof value === 'string' ? Array(value.length).fill(65) : value, setName(n) { this.name = n; return this; } });
  const file = { getSharingAccess: () => 'PRIVATE', getEditors: () => [], getViewers: () => [], getId: () => 'test-private-file', getSize: () => 1000 };
  const folder = { ...file, createFile(b) { saved = b; return file; } };
  const c = vm.createContext({ Date: Clock, console,
    LockService: { getUserLock: () => ({ tryLock: () => !options.busy, releaseLock: () => released++ }) },
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, createFolder: () => folder, getFolderById: () => folder },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties[k] || '', setProperty(k,v) { properties[k] = v; }, deleteProperty(k) { delete properties[k]; } }) },
    Utilities: { getUuid: () => 'test-lease', sleep: n => now += n, formatDate: () => '2026-11-01_120000', newBlob: blob, zip: (blobs, name) => ({ blobs, name }) },
    camVideoTest: () => ({ ok: true, mode: 'hls', url: 'https://video.example.test/a/live.m3u8?secret=AUTH-ONLY' }),
    UrlFetchApp: { fetch(url, opts) {
      requests++; assert.equal(opts.followRedirects, false);
      const text = url.includes('m3u8') ? (options.encrypted ? '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"' :
        '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n' + Array.from({length: 5}, (_, i) => '#EXTINF:5,\nseg' + i + '.ts').join('\n')) : '';
      return { getResponseCode: () => options.redirect ? 302 : (options.forbidden ? 403 : 200), getHeaders: () => ({ Location: 'https://video.example.test/a/redirect.m3u8' }), getContentText: () => text,
        getBlob: () => blob(options.invalidMedia ? [1,2,3] : [0x47, ...Array(187).fill(0)], '', '') };
    } }
  });
  vm.runInContext(source, c);
  return { c, folder, result: () => ({ saved, released, requests }) };
}
test('relative paths normalize and preserve explicit query only', () => {
  const {c} = setup();
  assert.equal(c.camRecUrl_('https://video.example.test/a/b.m3u8?auth=x','../c.ts?token=y'), 'https://video.example.test/c.ts?token=y');
});
test('provider HTTPS port and public IPv4 are supported without allowing LAN addresses', () => {
  const {c}=setup();
  assert.equal(c.camRecUrl_('https://8.8.8.8:8443/live/a.m3u8?x=y','b.ts'),'https://8.8.8.8:8443/live/b.ts');
  assert.equal(c.camRecUrl_('https://video.example.test:8443/live/a.m3u8','/b.ts'),'https://video.example.test:8443/b.ts');
  for (const ip of ['10.0.0.1','192.168.1.1','172.16.0.1','169.254.1.1','100.64.0.1']) assert.throws(()=>c.camRecUrl_('https://'+ip+':8443/a','b'));
});
test('foreign origins, private/IP hosts and unsafe URLs refused', () => {
  const {c} = setup();
  for (const uri of ['http://video.example.test/x','//evil.example/x','https://video.example.test.evil/x','data:x','x\\y']) assert.throws(() => c.camRecUrl_('https://video.example.test/a/live.m3u8',uri));
  for (const base of ['https://127.0.0.1/x','https://localhost/x','https://a.internal/x']) assert.throws(() => c.camRecUrl_(base,base));
});
test('encryption, byteranges and discontinuities fail closed', () => {
  const {c} = setup();
  for (const line of ['#EXT-X-KEY:METHOD=AES-128,URI="key"','#EXT-X-BYTERANGE:100','#EXT-X-DISCONTINUITY','#EXT-X-GAP']) assert.throws(() => c.camRecParse_('#EXTM3U\n'+line));
});
test('private archive contains local names and no signed URLs', () => {
  const s = setup();
  // Simulate advancing sliding window rather than repeatedly recording old segments.
  let seq = 0; s.c.camRecFetch_ = (url, text) => {
    if (text) return '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:' + seq++ + '\n#EXTINF:5,\nseg.ts';
    return { getBytes: () => [0x47,...Array(187).fill(0)], setName(name) { this.name = name; return this; } };
  };
  const r = s.c.camRecordSample({channel:4}), state = s.result();
  assert.equal(r.ok,true); assert.equal(r.seconds,20); assert.equal(state.released,2);
  const archive = JSON.stringify(state.saved);
  assert(!archive.includes('AUTH-ONLY')); assert(!archive.includes('https://')); assert(archive.includes('sample.m3u8'));
});
test('shared folder blocks before provider access', () => {
  const s = setup(); s.folder.getEditors = () => ['someone'];
  assert.equal(s.c.camRecordSample({channel:3}).code,'privacy'); assert.equal(s.result().requests,0);
});
test('busy/invalid channel cause no capture', () => {
  const s = setup({busy:true}); assert.equal(s.c.camRecordSample({channel:3}).stage,'busy');
  assert.equal(s.c.camRecordSample({channel:'3'}).stage,'channel'); assert.equal(s.result().requests,0);
});
test('encrypted media and redirects save nothing; lock always released', () => {
  for (const options of [{encrypted:true},{redirect:true},{invalidMedia:true}]) {
    const s=setup(options), r=s.c.camRecordSample({channel:3});
    assert.equal(r.ok,false); assert.equal(s.result().saved,null); assert.equal(s.result().released,2);
    assert(!JSON.stringify(r).includes('AUTH-ONLY'));
  }
});
test('HTTP denial exposes status only, never provider body or signed URL', () => {
  const s=setup({forbidden:true}), r=s.c.camRecordSample({channel:4});
  assert.equal(r.code,'http_403'); assert(!JSON.stringify(r).includes('AUTH-ONLY')); assert.equal(s.result().saved,null);
});
test('unchanging playlist times out instead of duplicating media', () => {
  const s=setup(), r=s.c.camRecordSample({channel:3});
  assert.equal(r.code,'short'); assert.equal(s.result().saved,null); assert(s.result().requests<30);
});
test('PIN required before recording route executes', () => {
  const c=vm.createContext({JSON,adminPinOk_: p=>p==='test',jsonResponseStaff:r=>r,dashLocked_:()=>false});
  vm.runInContext(fs.readFileSync(root+'/server/src/05_routing.js','utf8'),c);
  let called=0; c.camRecordSample = d=>{called++; return {ok:true,channel:d.channel};};
  const post=pin=>c.doPost({postData:{contents:JSON.stringify({action:'camRecordSample',channel:3,pin})}});
  assert.equal(post('wrong').pinError,true); assert.equal(called,0); assert.equal(post('test').channel,3); assert.equal(called,1);
});
console.log(tests,'camera-record checks passed');
