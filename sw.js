/* خدمة بسيطة: بتخلي التطبيق يفتح بسرعة وبدون نت (الشكل بس) —
   والصفحة نفسها بتتجاب من النت الأول عشان أي تحديث يظهر فورًا.
   بيانات النواقص مبتتخزنش أبدًا (دايمًا من السيرفر). */
var CACHE = 'sousy-shell-v1';
/* الصفحة والملف الوصفي بس — الأيقونات بتتخزّن لوحدها أول ما تتطلب، فغيابها مايوقفش التثبيت */
var SHELL = ['./orders.html', './manifest-orders.json'];

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
    }).catch(function(){ return caches.match(req).then(function(r){ return r || caches.match('./orders.html'); }); })
  );
});
