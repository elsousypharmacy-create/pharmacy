// ==== MODULE 23_ai (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 5) جيميني — مع حارس يمنع اختراع الأرقام
// ===================================================================

/* ═══ اختيار موديل الذكاء الاصطناعي ═══
   بيتظبط من لوحة التحكم (⚙️ ← الذكاء الاصطناعي) — مش محتاج تفتح الكود.
   المفاتيح بتتحفظ في Script properties على السيرفر، ومش بتظهر في أي صفحة.
   لو الموديل المختار فشل أو مفتاحه مش موجود → البوت بيرجع لـ Gemini تلقائيًا. */
const AI_PROVIDER = 'claude';   // الافتراضي لو لسه متظبطش من اللوحة
var AI_KEYS = { claude: 'CLAUDE_API_KEY', grok: 'GROK_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
var AI_DEFAULTS = {
  claude: { bot: 'claude-haiku-5-5', dose: 'claude-sonnet-5-5' },
  grok:   { bot: 'grok-4',           dose: 'grok-4' },
  openai: { bot: 'gpt-4.1-mini',     dose: 'gpt-4.1' },
  gemini: { bot: 'gemini-3.5-flash',  dose: 'gemini-3.5-flash' }   /* أقوى موديل مجاني — لو مش متاح بيرجع لـ flash-lite لوحده */
};

function aiKey_(name) {
  try { return PropertiesService.getScriptProperties().getProperty(name) || ''; } catch (e) { return ''; }
}
function aiCfg_() {
  var P = PropertiesService.getScriptProperties();
  var pr = P.getProperty('AI_PROVIDER') || AI_PROVIDER;
  if (!AI_DEFAULTS[pr]) pr = 'claude';
  var key = aiKey_(AI_KEYS[pr]) || (pr === 'gemini' ? GEMINI_API_KEY : '');
  return { provider: pr, key: key,
           bot: P.getProperty('AI_BOT_MODEL') || AI_DEFAULTS[pr].bot,
           dose: P.getProperty('AI_DOSE_MODEL') || AI_DEFAULTS[pr].dose };
}

/* ═══ عدّاد استهلاك الذكاء الاصطناعي ═══
   بيتسجل لكل نداء: عدد التوكنز (داخل/خارج) حسب النوع (بوت/جرعات/اختبار) والموديل، لكل شهر ولكل يوم.
   التكلفة تقديرية من أسعار Anthropic الرسمية (دولار لكل مليون توكن). باقي المزودين بنعرض التوكنز بس. */
var AI_PRICES = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20],
                  'claude-haiku-4-5': [1, 5] };
function aiCost_(model, tin, tout) {
  var p = AI_PRICES[model]; if (!p) return null;
  return (tin * p[0] + tout * p[1]) / 1e6;
}
function aiTrack_(kind, model, tin, tout) {
  if (!tin && !tout) return;
  var lock = LockService.getScriptLock();
  try { if (!lock.tryLock(3000)) return; } catch (e) { return; }
  try {
    var P = PropertiesService.getScriptProperties(), now = new Date();
    var mk = 'AI_USE_' + Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM');
    var day = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
    var u = {}; try { u = JSON.parse(P.getProperty(mk) || '{}'); } catch (e) {}
    var c = aiCost_(model, tin, tout);
    function add(o) { o.calls = (o.calls || 0) + 1; o.in = (o.in || 0) + tin; o.out = (o.out || 0) + tout;
                      if (c !== null) o.cost = Math.round(((o.cost || 0) + c) * 1e6) / 1e6; else o.unpriced = true; }
    add(u.total = u.total || {});
    u.kinds = u.kinds || {}; add(u.kinds[kind] = u.kinds[kind] || {});
    u.models = u.models || {}; add(u.models[model] = u.models[model] || {});
    u.days = u.days || {}; add(u.days[day] = u.days[day] || {});
    var ks = Object.keys(u.days).sort(); while (ks.length > 35) delete u.days[ks.shift()];
    P.setProperty(mk, JSON.stringify(u));
  } catch (e) {} finally { try { lock.releaseLock(); } catch (e2) {} }
}
function getAiUsage() {
  var P = PropertiesService.getScriptProperties(), now = new Date();
  var mk = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM');
  var prev = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - 1, 15), 'Africa/Cairo', 'yyyy-MM');
  var day = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
  function rd(k) { try { return JSON.parse(P.getProperty('AI_USE_' + k) || '{}'); } catch (e) { return {}; } }
  var cur = rd(mk), last = rd(prev);
  return { ok: true, month: mk, today: (cur.days || {})[day] || {}, current: cur, lastMonth: { month: prev, total: last.total || {} },
           provider: aiCfg_().provider, budget: parseFloat(P.getProperty('AI_BUDGET') || '0') || 0 };
}

/* نداء واحد لأي مزوّد — بيرجع النص أو null */
/* لو فيه حد أقصى شهري واتعدّى → نوقف الموديل المدفوع (البوت بيكمّل على Gemini الاحتياطي) */
function aiOverBudget_() {
  try {
    var P = PropertiesService.getScriptProperties(), b = parseFloat(P.getProperty('AI_BUDGET') || '0');
    if (!b) return false;
    var u = JSON.parse(P.getProperty('AI_USE_' + Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM')) || '{}');
    return ((u.total && u.total.cost) || 0) >= b;
  } catch (e) { return false; }
}
var AI_LAST_ERR = '';
function aiCall_(provider, key, model, prompt, maxTokens, kind) {
  if (!key) return null;
  if (provider !== 'gemini' && aiOverBudget_()) { Logger.log('الحد الأقصى الشهري للذكاء الاصطناعي اتعدّى'); return null; }
  try {
    var res, d;
    if (provider === 'claude') {
      res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify({ model: model, max_tokens: maxTokens || 600, messages: [{ role: 'user', content: prompt }] }) });
      if (res.getResponseCode() !== 200) { AI_LAST_ERR = 'Claude ' + res.getResponseCode(); Logger.log('Claude ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300)); return null; }
      d = JSON.parse(res.getContentText());
      if (d.usage) aiTrack_(kind || 'bot', model, d.usage.input_tokens || 0, d.usage.output_tokens || 0);
      return (d.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('') || null;
    }
    if (provider === 'grok' || provider === 'openai') {
      var url = provider === 'grok' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
      res = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + key },
        payload: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }] }) });
      if (res.getResponseCode() !== 200) { AI_LAST_ERR = provider + ' ' + res.getResponseCode(); Logger.log(provider + ' ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300)); return null; }
      d = JSON.parse(res.getContentText());
      if (d.usage) aiTrack_(kind || 'bot', model, d.usage.prompt_tokens || 0, d.usage.completion_tokens || 0);
      return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || null;
    }
    if (provider === 'gemini') {
      res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
          generationConfig: kind === 'dose' ? { temperature: 0.2, responseMimeType: 'application/json' } : { temperature: 0.4 } }) });
      if (res.getResponseCode() !== 200) {
        AI_LAST_ERR = 'Gemini ' + res.getResponseCode() + (res.getResponseCode() === 429 ? ' (وصل للحد المجاني في الدقيقة)' : '');
        Logger.log('Gemini ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300)); return null;
      }
      d = JSON.parse(res.getContentText());
      if (d.usageMetadata) aiTrack_(kind || 'bot', model, d.usageMetadata.promptTokenCount || 0,
                                    (d.usageMetadata.candidatesTokenCount || 0) + (d.usageMetadata.thoughtsTokenCount || 0));
      var c0 = d.candidates && d.candidates[0], parts = c0 && c0.content && c0.content.parts;
      var txt = (parts || []).filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join('');
      if (!txt) { AI_LAST_ERR = 'Gemini رجّع رد فاضي (' + ((c0 && c0.finishReason) || (d.promptFeedback && d.promptFeedback.blockReason) || '?') + ')'; Logger.log(AI_LAST_ERR); }
      return txt || null;
    }
  } catch (e) { AI_LAST_ERR = provider + ': ' + e.message; Logger.log('خطأ aiCall_ ' + provider + ': ' + e.message); }
  return null;
}

/* نقطة الدخول الوحيدة للبوت — كل البوت بينادي دي */
function callGemini(prompt, isRetry) {
  var c = aiCfg_();
  var out = aiCall_(c.provider, c.key, c.bot, prompt, 700);
  if (!out && c.provider !== 'gemini') {   /* المدفوع مش متاح (مفيش مفتاح/رصيد) → Gemini المجاني الأقوى */
    var gk = aiKey_('GEMINI_API_KEY') || GEMINI_API_KEY;
    out = aiCall_('gemini', gk, AI_DEFAULTS.gemini.bot, prompt, 700);
  }
  return out || callGeminiRaw_(prompt);   /* آخر احتياطي: flash-lite */
}

/* اختبار من لوحة التحكم */
function aiTest(q) {
  var c = aiCfg_(), t0 = Date.now(), who = c.provider + ' · ' + c.bot;
  var prompt = 'انت مساعد صيدلية مصرية. رد بجملة قصيرة بالعامية على العميل: ' + (q || 'عندكم بنادول؟');
  var r = aiCall_(c.provider, c.key, c.bot, prompt, 200, 'test');
  if (!r) { who = 'gemini (احتياطي)'; r = callGeminiRaw_(prompt); }
  return { ok: !!r, provider: who, hasKey: !!c.key, ms: Date.now() - t0, reply: r || 'مفيش رد' };
}

/* الإعدادات من اللوحة — محمية برقم سري (أول مرة بيتحفظ الرقم اللي تكتبه) */
function getAiConfig() {
  var c = aiCfg_(), keys = {};
  Object.keys(AI_KEYS).forEach(function (p) { var k = aiKey_(AI_KEYS[p]); keys[p] = k ? '••••' + k.slice(-4) : ''; });
  return { ok: true, provider: c.provider, bot: c.bot, dose: c.dose, keys: keys, defaults: AI_DEFAULTS,
           pinSet: !!aiKey_('ADMIN_PIN') };
}
/* التحقق من الرقم السري — مع تأخير بعد محاولات غلط كتير */
function adminPinOk_(pin) {
  var P = PropertiesService.getScriptProperties(), saved = P.getProperty('ADMIN_PIN');
  if (!saved) return false;
  if (String(pin || '') === saved) { P.deleteProperty('ADMIN_PIN_BAD'); return true; }
  var bad = parseInt(P.getProperty('ADMIN_PIN_BAD') || '0', 10) + 1;
  P.setProperty('ADMIN_PIN_BAD', String(bad));
  if (bad >= 10) Utilities.sleep(3000);
  return false;
}
function setAiConfig(d) {
  var P = PropertiesService.getScriptProperties();
  var pin = String(d.pin || '').trim(), saved = P.getProperty('ADMIN_PIN');
  if (!saved) {
    if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: 'اختار رقم سري من 4 لـ 8 أرقام' };
    P.setProperty('ADMIN_PIN', pin);
  } else if (pin !== saved) {
    var bad = parseInt(P.getProperty('ADMIN_PIN_BAD') || '0', 10) + 1;
    P.setProperty('ADMIN_PIN_BAD', String(bad));
    if (bad >= 10) Utilities.sleep(3000);
    return { ok: false, error: 'الرقم السري غلط' };
  }
  P.deleteProperty('ADMIN_PIN_BAD');
  if (d.provider && AI_DEFAULTS[d.provider]) P.setProperty('AI_PROVIDER', d.provider);
  if (d.key && AI_KEYS[d.provider]) P.setProperty(AI_KEYS[d.provider], String(d.key).trim());
  if (d.budget !== undefined && d.budget !== '') P.setProperty('AI_BUDGET', String(parseFloat(d.budget) || 0));
  if (d.bot !== undefined) { if (String(d.bot).trim()) P.setProperty('AI_BOT_MODEL', String(d.bot).trim()); else P.deleteProperty('AI_BOT_MODEL'); }
  if (d.dose !== undefined) { if (String(d.dose).trim()) P.setProperty('AI_DOSE_MODEL', String(d.dose).trim()); else P.deleteProperty('AI_DOSE_MODEL'); }
  return getAiConfig();
}

function callGeminiRaw_(prompt, isRetry) {
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': GEMINI_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const body = res.getContentText();
    if (code !== 200) {
      Logger.log('Gemini HTTP ' + code + ': ' + body.substring(0, 300));
      // منعملش إعادة محاولة بطيئة — أحسن نرد بسرعة من الكود
      return null;
    }
    const data = JSON.parse(body);
    if (!data.candidates || !data.candidates.length) return null;
    const parts = data.candidates[0].content && data.candidates[0].content.parts;
    if (!parts || !parts.length) return null;
    return parts[0].text;
  } catch (e) {
    Logger.log('خطأ callGemini: ' + e.message);
    return null;
  }
}

// الحارس: أي رقم في رد المودل مش في القايمة المسموحة = الرد مرفوض
/* ٠١٢٣ → 0123 عشان الحارس والموديل يفهموا الأرقام العربي */
function toAsciiDigits_(s) {
  return String(s || '').replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
                        .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
}
function replyHasInventedNumbers_(text, allowedNumbers) {
  const nums = toAsciiDigits_(text).match(/\d+(?:[.,]\d+)?/g);
  if (!nums) return false;
  for (var i = 0; i < nums.length; i++) {
    const n = Math.round(parseFloat(String(nums[i]).replace(',', '')));
    if (isNaN(n)) continue;
    if (n <= 12) continue;                          // أرقام صغيرة (عدد أنواع، ساعات) مقبولة
    if (allowedNumbers.indexOf(n) === -1) return true;
  }
  return false;
}
/* حارس العقل الجديد: بيراجع الأسعار بس (الرقم اللي جنبه "جنيه") وأرقام التليفونات.
   أرقام الجرعات والمواعيد ("كل 8 ساعات"، "3 مرات") مسموحة — دي كانت سبب رفض ردود الجرعات. */
function brainPriceGuard_(reply, allowed, phones) {
  var t = toAsciiDigits_(reply), m;
  var rx = /(\d+(?:[.,]\d+)?)\s*(?:جنيه|جنية|جنيهات|ج\.م|ج(?![؀-ۿ]))/g;
  while ((m = rx.exec(t))) {
    var n = Math.round(parseFloat(String(m[1]).replace(',', '.')));
    if (!isNaN(n) && allowed.indexOf(n) === -1) return 'سعر ' + n;
  }
  var rx2 = /(?:بسعر|السعر|سعره|سعرها|بـ)\s*:?\s*(\d+(?:[.,]\d+)?)/g;
  while ((m = rx2.exec(t))) {
    var n2 = Math.round(parseFloat(String(m[1]).replace(',', '.')));
    if (!isNaN(n2) && allowed.indexOf(n2) === -1) return 'سعر ' + n2;
  }
  var longs = t.match(/\d{7,}/g) || [], ok = (phones || []).map(function (p) { return String(p).replace(/\D/g, '').replace(/^(20|0)+/, ''); });
  for (var i = 0; i < longs.length; i++) {
    var L = longs[i].replace(/^(20|0)+/, '');
    if (!ok.some(function (p) { return p && (p === L || p.indexOf(L) !== -1 || L.indexOf(p) !== -1); })) return 'رقم ' + longs[i];
  }
  return '';
}

/* ممنوع البوت ينادي العميل باسم مش متسجل ("تمام يا آية") أو "يا فندم/يا غالي" —
   أي "يا + كلمة" بتتشال إلا لو الكلمة من الاسم المسجل أو اسم العميل قاله بنفسه. */
function allowedNames_(chatId, history) {
  var ok = {};
  String(honorName_(getKnownCustomerName_(chatId)) || '').split(/\s+/).forEach(function (w) { if (w) ok[normalizeArabic(w)] = 1; });
  (history || []).forEach(function (h) {
    if (h.role !== 'user') return;
    var m = normalizeArabic(h.text).match(/(?:اسمي|انا اسمي|معاك)\s+([^\s]+)/);
    if (m && ['ايه', 'اي', 'اية', 'مين', 'ايش'].indexOf(m[1]) === -1) ok[m[1]] = 1;
  });
  ['رب', 'ريت', 'سلام', 'جماعه'].forEach(function (w) { ok[w] = 1; });
  return ok;
}
function stripVocatives_(text, ok) {
  return String(text || '').replace(/\s*[،,]?\s*يا\s+([^\s،,.!؟?🌸🙏✅]+)/g, function (all, w) {
    return ok[normalizeArabic(w)] ? all : '';
  }).replace(/^\s*[،,]\s*/, '').replace(/\s+([،,.!؟?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

/* ذاكرة أسئلة الأمان (السن/حمل/أمراض/أدوية تانية) — 24 ساعة، عشان البوت ميسألش نفس الأسئلة تاني */
function safetyGet_(chatId) {
  try { return JSON.parse(CacheService.getScriptCache().get('safe_' + chatId) || 'null'); } catch (e) { return null; }
}
function safetyCapture_(chatId, text, history) {
  var lastBot = '';
  for (var i = (history || []).length - 1; i >= 0; i--) if (history[i].role === 'bot') { lastBot = history[i].text; break; }
  if (!/حمل|رضاع|امراض مزمن|أمراض مزمن|ادويه تاني|أدوية تاني|أدوية تانية|السن|سن حضرتك|كام سنة/.test(lastBot)) return;
  var n = normalizeArabic(text), s = safetyGet_(chatId) || {};
  var age = toAsciiDigits_(text).match(/\b(\d{1,3})\b/);
  if (age && +age[1] > 0 && +age[1] < 110 && (n.split(' ').length <= 4 || /سن|سنه|سنين|عمري/.test(n))) s.age = +age[1];
  var neg = /(^|\s)(لا|لاء|لأ|لا ابدا|مفيش|ولا حاجه|كله تمام|كله سليم|كلو تمام|سليم|تمام|الحمد لله|no)(\s|$)/.test(n);
  var sick = /(ضغط|سكر|قلب|كلي|كبد|قرحه|معده|ربو|حساسيه من)/.test(n) && !/(مفيش|لا |ولا)/.test(n);
  if (sick) { s.note = text; s.clear = false; }
  else if (neg) s.clear = true;
  s.t = Date.now();
  CacheService.getScriptCache().put('safe_' + chatId, JSON.stringify(s), 86400);
}

/* آخر أصناف اتعرضت على العميل بأسعارها — عشان ملخص الأوردر يحسب الإجمالي صح */
function quotedAdd_(chatId, items) {
  var c = CacheService.getScriptCache(), q = [];
  try { q = JSON.parse(c.get('quoted_' + chatId) || '[]'); } catch (e) {}
  (items || []).forEach(function (it) {
    q = q.filter(function (x) { return x.name !== it.name; });
    q.push({ name: it.name, price: Math.round(it.price) });
  });
  c.put('quoted_' + chatId, JSON.stringify(q.slice(-40)), 21600);
}
function quotedFind_(chatId, name) {
  var q = []; try { q = JSON.parse(CacheService.getScriptCache().get('quoted_' + chatId) || '[]'); } catch (e) {}
  var n = normalizeArabic(name).toLowerCase();
  for (var i = q.length - 1; i >= 0; i--) if (normalizeArabic(q[i].name).toLowerCase() === n) return q[i];
  for (var j = q.length - 1; j >= 0; j--) {
    var qn = normalizeArabic(q[j].name).toLowerCase();
    if (qn.indexOf(n) !== -1 || n.indexOf(qn) !== -1) return q[j];
  }
  return null;
}

/* إعدادات البوت من اللوحة: رسوم التوصيل، المواعيد، أقصى مسافة، مناطق التوصيل، قفل اللوحة.
   BOT_FREE_DELIVERY=1 أو رسوم 0 = توصيل مجاني. BOT_DELIVERY_AREAS = أسماء مناطق مفصولة بفاصلة أو سطر.
   BOT_PAUSED=1 يوقف الرد التلقائي على عملاء واتساب بس. تليجرام والتقارير والرد اليدوي لسه شغالين. */
function botSettings_() {
  var P = PropertiesService.getScriptProperties();
  var km = P.getProperty('BOT_MAX_KM');
  var fee = P.getProperty('BOT_DELIVERY_FEE');
  if (fee === null || fee === undefined) fee = '';
  return { fee: fee, hours: P.getProperty('BOT_HOURS') || '',
           maxKm: km === null ? 10 : (parseFloat(km) || 0), lock: P.getProperty('DASH_LOCK') === '1',
           freeDelivery: P.getProperty('BOT_FREE_DELIVERY') === '1' || String(fee) === '0',
           areas: P.getProperty('BOT_DELIVERY_AREAS') || '',
           paused: P.getProperty('BOT_PAUSED') === '1' };
}
function getBotSettings() { var s = botSettings_(); s.ok = true; s.pinSet = !!aiKey_('ADMIN_PIN'); return s; }
function setBotSettings(d) {
  if (!aiKey_('ADMIN_PIN')) return { ok: false, error: 'اختار رقم سري الأول من إعدادات الذكاء الاصطناعي' };
  if (!adminPinOk_(d.pin)) return { ok: false, pinError: true, error: 'الرقم السري غلط' };
  var P = PropertiesService.getScriptProperties();
  if (d.fee !== undefined) { var f = String(d.fee).trim(); if (f) P.setProperty('BOT_DELIVERY_FEE', String(parseFloat(f) || 0)); else P.deleteProperty('BOT_DELIVERY_FEE'); }
  if (d.hours !== undefined) { var h = String(d.hours).trim(); if (h) P.setProperty('BOT_HOURS', h.slice(0, 120)); else P.deleteProperty('BOT_HOURS'); }
  if (d.maxKm !== undefined && String(d.maxKm).trim() !== '') P.setProperty('BOT_MAX_KM', String(parseFloat(d.maxKm) || 0));
  if (d.lock !== undefined) P.setProperty('DASH_LOCK', String(d.lock) === '1' ? '1' : '0');
  if (d.free !== undefined) {
    if (String(d.free) === '1') P.setProperty('BOT_FREE_DELIVERY', '1');
    else {
      P.deleteProperty('BOT_FREE_DELIVERY');
      if (String(P.getProperty('BOT_DELIVERY_FEE') || '') === '0') P.deleteProperty('BOT_DELIVERY_FEE');
    }
  }
  if (d.areas !== undefined) {
    var ar = String(d.areas || '').trim();
    if (ar) P.setProperty('BOT_DELIVERY_AREAS', ar.slice(0, 1500));
    else P.deleteProperty('BOT_DELIVERY_AREAS');
  }
  if (d.paused !== undefined) botPauseSet_(String(d.paused) === '1');
  return getBotSettings();
}
function deliveryAreas_(s) {
  var raw = (s && s.areas != null) ? s.areas : (botSettings_().areas || '');
  return String(raw).split(/[\n,،;]+/).map(function (x) { return String(x).trim(); }).filter(Boolean);
}
/* free = مجاني، fee = رقم، ask = لسه هتتأكد */
function deliveryFeeInfo_(s) {
  s = s || botSettings_();
  var raw = String(s.fee == null ? '' : s.fee).trim();
  if (s.freeDelivery || raw === '0') return { kind: 'free', n: 0, line: 'التوصيل مجاني',
    prompt: 'التوصيل مجاني. قول "التوصيل مجاني" ومتقولش رقم رسوم ومتقولش إن الرسوم هتتأكد.' };
  var n = parseFloat(raw);
  if (raw && !isNaN(n) && n > 0) return { kind: 'fee', n: n, line: 'التوصيل: ' + n + ' جنيه', prompt: 'رسوم التوصيل: ' + n + ' جنيه.' };
  return { kind: 'ask', n: 0, line: 'رسوم التوصيل: هتتأكد مع حضرتك', prompt: 'رسوم التوصيل: متقولش رقم — قول إن الصيدلية هتأكدها.' };
}
function isPinAddress_(addr) {
  var raw = String(addr || '');
  if (/maps\.google|google\.com\/maps|maps\.app\.goo|goo\.gl\/maps/i.test(raw)) return true;
  if (/-?\d{2}\.\d{3,}\s*,\s*-?\d{2}\.\d{3,}/.test(raw)) return true;
  return false;
}
/* عنوان كامل = لوكيشن، أو منطقة + شارع + علامة/رقم عمارة */
function addressComplete_(addr) {
  var raw = String(addr || '').trim();
  if (isPinAddress_(raw)) return { ok: true, pin: true, missing: [] };
  var n = normalizeArabic(toAsciiDigits_(raw));
  var words = n.split(' ').filter(function (w) { return w.length >= 2; });
  var hasStreet = /(^|\s)(شارع|طريق|حاره|زنقه|زقاق|ميدان)(\s|$)/.test(n);
  var hasLandmark = /(عماره|برج|فيلا|دور|شقه|بجوار|جنب|امام|قصاد|مسجد|كنيسه|مدرسه|مستشف|محطه|صيدليه|مول|بلوك|مدخل|علامه|مميز)/.test(n) || /\d/.test(n);
  var missing = [];
  if (words.length < 4) missing.push('المنطقة');
  if (!hasStreet) missing.push('الشارع');
  if (!hasLandmark) missing.push('علامة مميزة أو رقم العمارة');
  return { ok: missing.length === 0, pin: false, missing: missing };
}
function addressAsk_(ac) {
  var miss = (ac && ac.missing) || [];
  if (!miss.length) return 'ممكن حضرتك تبعت العنوان كامل: المنطقة، والشارع، وعلامة مميزة أو رقم العمارة، أو تبعت اللوكيشن.';
  return 'العنوان لسه ناقصه ' + miss.join(' و') + '.\nابعت لحضرتك الجزء الناقص بس، أو ابعت اللوكيشن.';
}
/* لو فيه قائمة مناطق، العنوان المكتوب لازم يطابق واحدة. اللوكيشن بيتراجع بالمسافة مش بالاسم. */
function addressInDeliveryArea_(addr) {
  var areas = deliveryAreas_();
  if (!areas.length) return { ok: true, checked: false };
  if (isPinAddress_(addr)) return { ok: true, checked: false, pin: true };
  var n = normalizeArabic(addr), nk = stockKey_(addr);
  for (var i = 0; i < areas.length; i++) {
    var a = normalizeArabic(areas[i]), ak = stockKey_(areas[i]);
    if (a && n.indexOf(a) !== -1) return { ok: true, checked: true, area: areas[i] };
    if (ak && ak.length >= 3 && nk.indexOf(ak) !== -1) return { ok: true, checked: true, area: areas[i] };
  }
  return { ok: false, checked: true };
}
function outOfAreaReply_() {
  return 'العنوان ده بره منطقة التوصيل بتاعتنا. الدكتور هيكلم حضرتك هنا يشوف نقدر نوصّل ولا لأ.';
}

/* مكان الصيدلية = متوسط (وسيط) مواقع عملاء الدليفري — من غير ما نحتاج نكتب إحداثيات */
function pharmacyCenter_() {
  var c = CacheService.getScriptCache(), hit = c.get('phcenter');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var P = PropertiesService.getScriptProperties();
  var pl = parseFloat(P.getProperty('PHARMACY_LAT')), pg = parseFloat(P.getProperty('PHARMACY_LNG'));
  var out = null;
  if (!isNaN(pl) && !isNaN(pg)) out = { lat: pl, lng: pg };
  else {
    try {
      var sh = SpreadsheetApp.openById(DELIVERY_SHEET_ID).getSheetByName('العملاء');
      var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
      var iLa = h.indexOf('خط العرض'), iLo = h.indexOf('خط الطول'), las = [], los = [];
      for (var i = 1; i < v.length; i++) {
        var a = parseFloat(v[i][iLa]), b = parseFloat(v[i][iLo]);
        if (!isNaN(a) && !isNaN(b) && a > 20 && a < 33 && b > 24 && b < 37) { las.push(a); los.push(b); }
      }
      if (las.length >= 5) {
        las.sort(); los.sort();
        out = { lat: las[Math.floor(las.length / 2)], lng: los[Math.floor(los.length / 2)] };
      }
    } catch (e) {}
  }
  if (out) c.put('phcenter', JSON.stringify(out), 21600);
  return out;
}
function distKm_(a1, o1, a2, o2) {
  var R = 6371, r = Math.PI / 180, da = (a2 - a1) * r, dobj = (o2 - o1) * r;
  var x = Math.sin(da / 2) * Math.sin(da / 2) + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dobj / 2) * Math.sin(dobj / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}