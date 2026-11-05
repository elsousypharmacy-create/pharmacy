/* خدمة بسيطة: بتخلي التطبيق يفتح بسرعة وبدون نت (الشكل بس) —
   والصفحة نفسها بتتجاب من النت الأول عشان أي تحديث يظهر فورًا.
   بيانات النواقص مبتتخزنش أبدًا (دايمًا من السيرفر). */
var CACHE = 'sousy-shell-v2';
/* ملفات ثابتة فقط؛ لا تُخزن استجابات Apps Script أو بيانات المالك. */
var SHELL = ['./orders.html', './manifest-orders.json', './index.html', './manifest-index.json',
  './dashboard-ui.css', './camera-assessment.js', './fonts/cairo.woff', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return Promise.all(SHELL.map(function(u){ return c.add(u).catch(function(){}); })); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;          // السكربت والخطوط: من النت دايمًا
  e.respondWith(
    fetch(req).then(function(res){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(req, copy); });
      return res;
    }).catch(function(){ return caches.match(req).then(function(r){
      if (r) return r;
      if (req.destination === 'document' && /\/orders\.html$/.test(url.pathname)) return caches.match('./orders.html');
      return Response.error();
    }); })
  );
});
