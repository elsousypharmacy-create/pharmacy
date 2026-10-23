// ==== MODULE 29_telegram_webhook (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 10) إرسال تليجرام
// ===================================================================

/* تليجرام سقفه 4096 حرف للرسالة — الأطول بتتقسّم هنا تلقائي على حدود الأسطر،
   فأي رسالة طويلة (نواقص، تقارير) توصل كاملة بدل ما تترفض. */
function sendTelegramStaff(message, chatId) {
  if (holdBlocksBotSend_(chatId, message)) { Logger.log('hold: منع رد البوت ' + chatId); return; }
  if (isWa_(chatId)) { waSend_(String(chatId), message); return; }
  const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
  var text = String(message == null ? '' : message), MAX = 3800, parts = [];
  if (text.length <= MAX) {
    parts = [text];
  } else {
    var cur = '';
    text.split('\n').forEach(function (line) {
      while (line.length > MAX) {                     // سطر واحد أطول من الحد
        if (cur) { parts.push(cur); cur = ''; }
        parts.push(line.substring(0, MAX)); line = line.substring(MAX);
      }
      if ((cur + line).length + 1 > MAX) { parts.push(cur); cur = ''; }
      cur += line + '\n';
    });
    if (cur) parts.push(cur);
  }
  parts.forEach(function (p, i) {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId,
        text: p + (parts.length > 1 ? '\n(' + (i + 1) + '/' + parts.length + ')' : '') }),
      muteHttpExceptions: true
    });
    if (i < parts.length - 1) Utilities.sleep(400);
  });
}

function sendTelegram_(chatId, message) {
  if (holdBlocksBotSend_(chatId, message)) { Logger.log('hold: منع رد البوت ' + chatId); return false; }
  sendTelegramStaff(varyEmoji_(chatId, message), chatId);
  return true;
}

// مؤشر "بيكتب دلوقتي..."
function sendTypingAction_(chatId) {
  if (isWa_(chatId)) { try { waTyping_(String(chatId)); } catch (e) {} return; }
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendChatAction', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

// ===================================================================
// 11) إعداد الويبهوك (الرد في ثانية بدل دقيقة)
// ===================================================================

// ⚠️ حط هنا لينك الـ Web App بتاعك — لازم ينتهي بـ /exec مش /dev
// تجيبه منين: Deploy > New deployment > Web app
//   Execute as: Me   |   Who has access: Anyone
// وبعد ما يطلعلك اللينك، انسخه وحطه هنا بين علامتي التنصيص.
/* لينك الوسيط (Cloudflare Worker) لو متسجل — بيرد على تليجرام فورًا ويوصّل الرسالة هنا.
   من غيره تليجرام بيستلم 302 من جوجل ويفتكرها فشل ويعيد ويأخّر الرسايل. */
function tgHookUrl_() {
  var r = '';
  try { r = PropertiesService.getScriptProperties().getProperty('TG_RELAY_URL') || ''; } catch (e) {}
  return r || WEB_APP_URL;
}
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyETI5UTPwpMFOu-aWoKKHqyppa7ctTVJjckmbTxegDq7E3R3p6aEBzqt275HNL8SBfWg/exec';

// شغّلها مرة واحدة بعد ما تحط اللينك فوق
/* حالة البوت من لوحة التحكم */
function botStatus() {
  try {
    var r = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getWebhookInfo',
      { muteHttpExceptions: true }).getContentText()).result || {};
    var props = PropertiesService.getScriptProperties();
    return { ok: true, url: r.url || '', viaRelay: !!props.getProperty('TG_RELAY_URL') && r.url === props.getProperty('TG_RELAY_URL'),
             pending: r.pending_update_count || 0, lastError: r.last_error_message || '',
             lastErrorAt: r.last_error_date ? Utilities.formatDate(new Date(r.last_error_date * 1000), 'Africa/Cairo', 'yyyy-MM-dd HH:mm') : '',
             polling: !r.url, provider: aiCfg_().provider, hasKey: !!aiCfg_().key, paused: botPaused_() };
  } catch (e) { return { ok: false, error: e.message, paused: botPaused_() }; }
}
/* بيسجّل لينك الوسيط ويحوّل تليجرام عليه */
function botSetRelay(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/[^\s]+$/.test(url)) return { ok: false, error: 'اللينك لازم يبدأ بـ https://' };
  var props = PropertiesService.getScriptProperties();
  var res = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN +
    '/setWebhook?drop_pending_updates=true&url=' + encodeURIComponent(url), { muteHttpExceptions: true }).getContentText());
  if (res.ok) { props.setProperty('TG_RELAY_URL', url); props.setProperty('telegramWebhookOn', 'yes'); props.setProperty('queueCleared', 'yes'); }
  return { ok: !!res.ok, error: res.ok ? '' : (res.description || 'فشل') };
}

function setTelegramWebhook() {
  var url = WEB_APP_URL;

  if (!url || url.indexOf('ضع_لينك') !== -1) {
    Logger.log('❌ لسه محطتش اللينك في WEB_APP_URL فوق');
    Logger.log('   روح Deploy > New deployment > Web app، وانسخ اللينك وحطه هناك');
    return;
  }
  if (url.indexOf('/dev') !== -1) {
    Logger.log('❌ ده لينك تطوير (/dev) — تليجرام مش هيقدر يدخله وهيرجع 401');
    Logger.log('   لازم اللينك اللي بينتهي بـ /exec من Manage deployments');
    return;
  }
  if (url.indexOf('/exec') === -1) {
    Logger.log('❌ اللينك لازم ينتهي بـ /exec');
    return;
  }

  // drop_pending_updates=true → بيفضّي أي رسايل قديمة متراكمة في الطابور
  PropertiesService.getScriptProperties().deleteProperty('queueCleared');

  const res = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook?drop_pending_updates=true&url=' + encodeURIComponent(url),
    { muteHttpExceptions: true }
  );
  Logger.log(res.getContentText());

  const ok = JSON.parse(res.getContentText()).ok;
  if (ok) {
    PropertiesService.getScriptProperties().setProperty('telegramWebhookOn', 'yes');
    Logger.log('✅ الويبهوك اتفعّل — استنى دقيقة وشغّل checkWebhook للتأكد');
  }
}

// 🧹 بيفضّي الرسايل القديمة المتراكمة من غير ما يلمس أي إعداد تاني
// شغّلها لو حسيت إن البوت بيرد على رسايل قديمة أو بيتأخر بشكل غريب
function clearPendingQueue() {
  const before = JSON.parse(UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + BOT_TOKEN + '/getWebhookInfo',
    { muteHttpExceptions: true }).getContentText());
  const n = (before.result && before.result.pending_update_count) || 0;
  Logger.log('رسايل متراكمة في الطابور: ' + n);

  if (!WEB_APP_URL || WEB_APP_URL.indexOf('/exec') === -1) {
    Logger.log('❌ WEB_APP_URL مش مظبوط');
    return;
  }

  UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + BOT_TOKEN +
    '/setWebhook?drop_pending_updates=true&url=' + encodeURIComponent(tgHookUrl_()),
    { muteHttpExceptions: true });

  Logger.log('✅ الطابور اتفضّى — ابعت رسالة جديدة دلوقتي وشوف بترد في كام ثانية');
}

function deleteTelegramWebhook() {
  const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/deleteWebhook';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  Logger.log(res.getContentText());
  PropertiesService.getScriptProperties().deleteProperty('telegramWebhookOn');
  Logger.log('🛑 الويبهوك اتقفل — رجعنا للـ polling كل دقيقة');
}