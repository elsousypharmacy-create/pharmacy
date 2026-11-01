// Offline regression checks: no Hikvision requests, no real account data.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const root = require('path').join(__dirname, '..');
const cameraSource = fs.readFileSync(root + '/server/src/66_cameras.js', 'utf8');
const probeSource = fs.readFileSync(root + '/server/src/66_cam_video.js', 'utf8');
const routingSource = fs.readFileSync(root + '/server/src/05_routing.js', 'utf8');
const serial = 'test-recorder', secret = 'PRIVATE-TEST-SECRET';
const camera = { id: 'entrance-resource', device: { devInfo: { serialNo: serial }, channelInfo: { no: '4' } } };
const success = data => ({ code: 200, json: { errorCode: '0', data } });
function run(handler, tokenError, request) {
  const calls = [];
  const c = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'CAM_DEVICE_SERIAL' ? serial : '' }) } });
  vm.runInContext(cameraSource + '\n' + probeSource, c);
  c.camToken_ = () => tokenError ? { error: secret } : { token: secret };
  c.camPost_ = (path, body, token) => {
    calls.push({ path, body, token });
    assert.equal(token, secret);
    return handler(path, body);
  };
  const result = c.camVideoTest(request);
  assert(!JSON.stringify(result).includes(secret), 'must not leak auth secrets or upstream error text');
  return { c, result, calls };
}
let tests = 0;
const test = (name, fn) => { fn(); tests++; console.log('OK', name); };
test('exact device and channel; fluent HLS request; no SDK token returned', () => {
  const { result, calls } = run((p, b) => {
    if (p.includes('cameras/get')) return success({ camera: [
      { ...camera, id: 'wrong-device', device: { devInfo: { serialNo: 'other' }, channelInfo: { no: 4 } } },
      { ...camera, id: 'wrong-channel', device: { devInfo: { serialNo: serial }, channelInfo: { no: 3 } } }, camera
    ] });
    assert.equal(b.resourceId, 'entrance-resource'); assert.equal(b.protocol, 2);
    assert.equal(b.type, '1'); assert.equal(b.quality, '2'); assert.equal(b.expireTime, 60);
    return success({ url: 'https://stream.example.test/live.m3u8?short-lived=test' });
  });
  assert.equal(result.mode, 'hls'); assert.equal(result.stage, 'address'); assert.equal(calls.length, 2);
  assert(!('appToken' in result));
});
test('counter 3 selects exact resource instead of entrance 4', () => {
  const counter = { ...camera, id: 'counter-resource', device: { devInfo: { serialNo: serial }, channelInfo: { no: '3' } } };
  const { result } = run((p, b) => {
    if (p.includes('cameras/get')) return success({ camera: [camera, counter] });
    assert.equal(b.resourceId, 'counter-resource');
    return success({ url: 'https://stream.example.test/counter.m3u8' });
  }, false, { channel: 3 });
  assert.equal(result.channel, 3); assert.equal(result.mode, 'hls');
});
test('other channels and malformed values make no provider requests', () => {
  for (const channel of [1, 2, 6, null, true, [], {}, '3x']) {
    const { result, calls } = run(() => { throw Error('must not request'); }, false, { channel });
    assert.equal(result.stage, 'channel'); assert.equal(calls.length, 0);
  }
});
test('encrypted / unsupported HLS reports SDK required without playback claims', () => {
  const { result } = run((p, b) => p.includes('cameras/get') ? success({ camera: [camera] }) :
    b.protocol === 2 ? { code: 200, json: { errorCode: 'EVZ60019', message: secret } } : success({ playUrl: 'ezopen://provider/live' }));
  assert.equal(result.stage, 'sdk_required'); assert.equal(result.mode, 'ezopen'); assert(!('url' in result));
});
test('raw provider error and signed URL do not leak on failure', () => {
  const { result } = run(() => ({ code: 403, json: { errorCode: 'DENIED', message: secret, data: { url: secret } } }));
  assert.equal(result.ok, false); assert.equal(result.stage, 'camera'); assert.equal(result.providerCode, 'DENIED');
});
test('no camera mapping means no live request', () => {
  const { result, calls } = run(() => success({ camera: [{ id: 'unknown', channelNo: 4 }] }));
  assert.equal(result.ok, false); assert.equal(calls.length, 1);
});
test('pagination finds entrance on second page', () => {
  const { result, calls } = run((p, b) => p.includes('cameras/get') ? success({ totalCount: 101, camera: b.pageIndex === 1 ? Array(100).fill({}) : [camera] }) :
    success({ url: 'https://stream.example.test/live.m3u8' }));
  assert.equal(result.mode, 'hls'); assert.equal(calls.length, 3);
});
test('auth failures expose no stored key / token and make no requests', () => {
  const { result, calls } = run(() => { throw Error('should not request'); }, true);
  assert.equal(result.stage, 'auth'); assert.equal(calls.length, 0);
});
test('unexpected network exception is safely summarized', () => {
  const { result } = run(() => { throw Error(secret); }); assert.equal(result.ok, false);
});
test('insecure HLS URL is not returned to browser', () => {
  const { result } = run((p, b) => p.includes('cameras/get') ? success({ camera: [camera] }) :
    success({ url: b.protocol === 2 ? 'http://stream.example.test/live.m3u8' : 'ezopen://provider/live' }));
  assert.equal(result.stage, 'sdk_required'); assert(!('url' in result));
});
test('POST route refuses bad PIN before invoking probe', () => {
  const c = vm.createContext({ JSON, adminPinOk_: p => p === 'test-pin', jsonResponseStaff: x => x, dashLocked_: () => false });
  vm.runInContext(routingSource, c);
  let called = 0; c.camVideoTest = data => { assert.equal(data.channel, 3); called++; return { ok: true, stage: 'address' }; };
  let response = c.doPost({ postData: { contents: JSON.stringify({ action: 'camVideoTest', pin: 'wrong' }) } });
  assert.equal(response.pinError, true); assert.equal(called, 0);
  response = c.doPost({ postData: { contents: JSON.stringify({ action: 'camVideoTest', pin: 'test-pin', channel: 3 }) } });
  assert.equal(response.ok, true); assert.equal(called, 1);
});
console.log(tests, 'camera-video checks passed');
