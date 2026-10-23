// ==== MODULE 15_tests_misc (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 12) اختبارات — شغّلهم من المحرر قبل ما تعتمد على البوت
// ===================================================================

// 🧪 اختبار (1): بيجرب الردود جوه المحرر — من غير تليجرام ولا ويبهوك ولا Deploy
function testBotNow() {
  const samples = ['اهلا', 'بنادول', 'سعر كاتافلام كام', 'شكرا', 'نقاطي كام'];
  samples.forEach(function(t) {
    Logger.log('────────────────');
    Logger.log('👤 العميل: ' + t);
    var reply;
    try {
      reply = tryLocalReply_(String(PERSONAL_CHAT), t, []);
    } catch (e) {
      reply = '❌ خطأ: ' + e.message;
    }
    Logger.log('🤖 البوت: ' + (reply || '(الرد ده محتاج الذكاء الاصطناعي)'));
  });
  Logger.log('────────────────');
  Logger.log('لو شفت ردود صح فوق ← الكود تمام، المشكلة في التوصيل.');
}

// 🧪 اختبار (2): بيبعتلك رسالة فعلية على تليجرام
function testSendToMe() {
  try {
    sendTelegramStaff('🧪 رسالة اختبار من الاسكربت — لو وصلتك يبقى الإرسال شغال', PERSONAL_CHAT);
    Logger.log('✅ اتبعتت — شوف تليجرام');
  } catch (e) {
    Logger.log('❌ فشل الإرسال: ' + e.message);
  }
}

function testGemini() {
  const result = callGemini('قول مرحبا بجملة قصيرة');
  Logger.log(result ? ('✅ جيميني شغال: ' + result) : '❌ جيميني مش شغال — راجع المفتاح في الـ Logs');
}

function testStockSearch() {
  const tests = ['بنادول', 'بانادول اكسترا', 'كاتافلام', 'البنادول', 'باراسيتامول'];
  tests.forEach(function(q) {
    const r = searchStock(q);
    Logger.log('🔎 "' + q + '" → ' + r.length + ' نتيجة');
    r.slice(0, 3).forEach(function(it) {
      Logger.log('    ' + it.name + ' | ' + it.price + ' ج | رصيد ' + it.stock);
    });
  });
}

function setupStaffTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const name = t.getHandlerFunction();
    if (['checkStaffOrders', 'checkStaffMessages', 'sendMiddayReport', 'sendNightReport'].includes(name)) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('checkStaffOrders').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('checkStaffMessages').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('sendNightReport').timeBased().atHour(0).everyDays(1).create();
}

function sendNightReport() {
  try { deduplicateStaffSheet(); } catch(e) { Logger.log('خطأ في التنظيف التلقائي: ' + e.message); }
  const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
  const yDate = Utilities.formatDate(yesterday, 'Africa/Cairo', 'yyyy-MM-dd');
  const yDateStr = Utilities.formatDate(yesterday, 'Africa/Cairo', 'dd/MM/yyyy');
  getReportForDate(yDate, 'ملخص اليوم - ' + yDateStr, STAFF_GROUP);
  const firstOfMonth = yDate.substring(0, 7) + '-01';
  getReportForRange(firstOfMonth, yDate, 'الشهر حتى ' + yDateStr, STAFF_GROUP);
}

var CARE_WEIGHTS = {
  new_customers: 0.35,
  registration: 0.30,
  repeat: 0.20,
  low_returns: 0.15
};

function getConnecteamTimeClocks() {
  const url = 'https://api.connecteam.com/time-clock/v1/time-clocks';
  const res = UrlFetchApp.fetch(url, {
    headers: { 'X-API-KEY': CONNECTEAM_API_KEY },
    muteHttpExceptions: true
  });
  Logger.log(res.getContentText());
}

function connecteamReady_() {
  if (!CONNECTEAM_API_KEY || CONNECTEAM_API_KEY.indexOf('ضع_') === 0) return 'لسه محطتش مفتاح Connecteam API';
  if (!CONNECTEAM_TIME_CLOCK_ID || CONNECTEAM_TIME_CLOCK_ID.indexOf('ضع_') === 0) return 'لسه محطتش Time Clock ID';
  return null;
}