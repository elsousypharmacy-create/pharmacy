// ==== MODULE 24_bot_features (split from server/Code.js; load order = file name order) ====


/* 🎤 الرسايل الصوتية → كلام مكتوب (Gemini المجاني) */
function transcribeVoice_(fileId, mime) {
  try {
    var blob = tgFileBlob_(fileId);
    if (!blob) return '';
    var b64 = Utilities.base64Encode(blob.getBytes());
    var key = aiKey_('GEMINI_API_KEY') || GEMINI_API_KEY;
    var prompt = 'اكتب الكلام اللي في التسجيل الصوتي ده بالظبط زي ما اتقال (عامية مصرية)، من غير أي إضافة أو شرح. ' +
                 'أسماء الأدوية اكتبها زي ما اتنطقت. لو مفيش كلام مفهوم رجّع كلمة NONE بس.';
    var models = [AI_DEFAULTS.gemini.bot, GEMINI_MODEL];
    for (var i = 0; i < models.length; i++) {
      var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime || 'audio/ogg', data: b64 } }, { text: prompt }] }],
                                  generationConfig: { temperature: 0 } }) });
      if (res.getResponseCode() !== 200) { Logger.log('voice ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200)); continue; }
      var d = JSON.parse(res.getContentText());
      if (d.usageMetadata) aiTrack_('voice', models[i], d.usageMetadata.promptTokenCount || 0, d.usageMetadata.candidatesTokenCount || 0);
      var p = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
      var t = String((p && p[0] && p[0].text) || '').trim();
      if (t && !/^NONE\.?$/i.test(t)) return t.slice(0, 600);
      return '';
    }
  } catch (e) { Logger.log('خطأ transcribeVoice_: ' + e.message); }
  return '';
}

/* 📷 قراية صورة العميل (علبة دوا أو روشتة) بـ Gemini المجاني */
var PHOTO_CTX = null;   /* بيتملى أثناء الرد على صورة — العقل بيدوّر بالأسماء اللي فيها */
function readPhoto_(fileIds) {
  try {
    fileIds = [].concat(fileIds).slice(0, 6);
    var imgs = [];
    fileIds.forEach(function (fid) {
      var blob = tgFileBlob_(fid);
      if (!blob) return;
      imgs.push({ inline_data: { mime_type: 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } });
    });
    if (!imgs.length) return null;
    var key = aiKey_('GEMINI_API_KEY') || GEMINI_API_KEY;
    var prompt = 'You are a pharmacist assistant in Egypt. Look at this photo from a customer.\n' +
      'kind: "prescription" if it is a doctor prescription (printed or handwritten); "box" if it shows medicine/cosmetic package(s); otherwise "other".\n' +
      'items: EVERY product you can read. For a prescription go line by line: EXACTLY ONE item per prescribed line (drops, capsules, creams, washes…). ' +
      'If a line has a brand name plus a description/ingredient (e.g. "Sansovit — vitamin D drops"), that is ONE product: name = the brand only, and the description goes in "use". ' +
      'Never split one line into two items, and ignore dosing instructions lines. ' +
      'Each as {"name":"trade name in English as printed","strength":"","form":"tablet/syrup/cream/...","use":"purpose in a few English words (e.g. oily skin facial wash, post-laser moisturizer, vitamin D drops)","sure":true}. ' +
      'For handwriting: "sure":true ONLY if every letter of the name is clearly legible; otherwise "sure":false (better unsure than a wrong confident name).\n' +
      'rx: true if the package says prescription only or it is a chronic/prescription drug (antidiabetic, antihypertensive, antibiotic...).\n' +
      'label: usage/storage notes PRINTED on the box only, TRANSLATED to simple Egyptian Arabic (never English), e.g. "Do not crush, cut or chew" → "يتبلع صحيح من غير كسر أو مضغ". Never invent a dose. Empty if none.\n' +
      'handwritten: true if it is a prescription written by hand (even partly), false if fully printed/typed.\n' +
      'Reply JSON only: {"kind":"box","handwritten":false,"items":[{"name":"","strength":"","form":"","use":"","sure":true}],"rx":false,"label":""}';
    function req(model, img) {
      return { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ parts: [img, { text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }) };
    }
    function parse(res, model) {
      if (res.getResponseCode() !== 200) { Logger.log('photo ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200)); return null; }
      var d = JSON.parse(res.getContentText());
      if (d.usageMetadata) aiTrack_('photo', model, d.usageMetadata.promptTokenCount || 0, d.usageMetadata.candidatesTokenCount || 0);
      var p = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
      return doseJson_((p || []).filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join(''));
    }
    /* ⚡ كل صورة لوحدها بس كلهم في نفس الوقت (أدق من صورة واحدة فيها الكل، ومن غير وقت زيادة) */
    /* 👁️ الصور على Gemini 3.8 Flash (أدق في خط الإيد — مجاني 20 طلب/يوم)؛ لو خلص أو مش متاح → 3.5 Flash → Flash-Lite */
    var M1 = aiKey_('PHOTO_MODEL') || 'gemini-3.8-flash', backups = [AI_DEFAULTS.gemini.bot, GEMINI_MODEL].filter(function (m, i, a) { return m && m !== M1 && a.indexOf(m) === i; });
    var outs = UrlFetchApp.fetchAll(imgs.map(function (im) { return req(M1, im); })).map(function (r) { return parse(r, M1); });
    outs = outs.map(function (o, i) {
      for (var b = 0; !o && b < backups.length; b++) o = parse(UrlFetchApp.fetchAll([req(backups[b], imgs[i])])[0], backups[b]);
      return o;
    });
    var good = outs.filter(Boolean);
    if (!good.length) return null;
    var seenN = {}, items = [];
    good.forEach(function (o) { (o.items || []).forEach(function (it) {
      var k = String(it.name || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
      it.fromBox = o.kind === 'box';   /* اسم مطبوع على علبة (مش خط إيد) */
      it.hand = o.kind === 'prescription';   /* من الروشتة (غالبًا خط إيد) */
      if (k && !seenN[k]) { seenN[k] = 1; items.push(it); }
    }); });
    var kinds = good.map(function (o) { return o.kind; });
    return { kind: kinds.indexOf('prescription') !== -1 ? 'prescription' : (kinds.indexOf('box') !== -1 ? 'box' : 'other'),
             handwritten: good.some(function (o) { return o.kind === 'prescription' && o.handwritten !== false; }),
             items: items, rx: good.some(function (o) { return o.rx; }),
             label: (good.filter(function (o) { return o.label; })[0] || {}).label || '' };
  } catch (e) { Logger.log('خطأ readPhoto_: ' + e.message); }
  return null;
}

/* ⛔ وقف الرد التلقائي على عملاء واتساب بس (شات wa_*). الخاصية BOT_PAUSED=1.
   تليجرام والتقارير وتنبيهات الصيدلي مش بتتأثر.
   الكاش 30 ثانية عشان الويبهوك ميقراش الخاصية على كل رسالة، وبيتمسح لحظة التبديل. */
function botPaused_() {
  try {
    var c = CacheService.getScriptCache(), hit = c.get('bot_paused');
    if (hit === '1' || hit === '0') return hit === '1';
    var on = PropertiesService.getScriptProperties().getProperty('BOT_PAUSED') === '1';
    try { c.put('bot_paused', on ? '1' : '0', 30); } catch (eP) {}
    return on;
  } catch (e) {
    try { return PropertiesService.getScriptProperties().getProperty('BOT_PAUSED') === '1'; } catch (e2) { return false; }
  }
}
function botPauseSet_(on) {
  PropertiesService.getScriptProperties().setProperty('BOT_PAUSED', on ? '1' : '0');
  try { CacheService.getScriptCache().remove('bot_paused'); } catch (e) {}
}
/* من شات الصيدلي بس: /botoff يوقف بوت الواتساب، /boton يرجّعه. */
function botToggleCmd_(chatId, text) {
  if (String(chatId) !== String(PERSONAL_CHAT)) return false;
  var cmd = String(text || '').split(/\s+/)[0].toLowerCase();
  var at = cmd.indexOf('@');
  if (at !== -1) cmd = cmd.slice(0, at);
  if (cmd === '/bottest') {
    var arg = String(text || '').replace(/^\S+\s*/, '').trim();
    if (arg === 'off') testNumbersSet_([]);
    else if (arg) testNumbersSet_(arg.split(/[\s,،]+/));
    sendTelegramStaff('🧪 أرقام التجربة (البوت بيرد عليها حتى وهو واقف): ' + (testNumbers_().join('، ') || 'مفيش') +
      '\nلتغييرها: /bottest 01120372238 01012345678\nللمسح: /bottest off', PERSONAL_CHAT);
    return true;
  }
  if (cmd !== '/botoff' && cmd !== '/boton') return false;
  var pause = cmd === '/botoff';
  botPauseSet_(pause);
  sendTelegramStaff(pause
    ? '⛔ بوت الواتساب واقف. رسايل الواتساب هتوصلك هنا ومش هيرد عليهم.'
    : '▶️ بوت الواتساب رجع يرد على العملاء.', PERSONAL_CHAT);
  return true;
}
/* 🤫 الصيدلي ماسك المحادثة — البوت يسكت وكل رسايل العميل توصلك (ساعتين أو لحد ما ترجّعه).
   وقف الواتساب = نفس الإمساك على شاتات wa_* بس، فالرسالة تتسجل وتوصل للصيدلي من غير رد آلي.
   الفحص لحظة الإرسال مش بس أول الرسالة: رد الصيدلي من الواتساب ممكن يوصل والبوت لسه مستني الموديل. */
function holdOn_(cid) {
  if (botPaused_() && isWa_(cid) && !isTestChat_(cid)) return true;
  return !!CacheService.getScriptCache().get('hold_' + cid);
}
function holdBlocksBotSend_(chatId, text) {
  if (!chatId || String(chatId) === String(PERSONAL_CHAT)) return false;
  if (!holdOn_(chatId)) return false;
  var t = String(text || '');
  if (t.indexOf('رد الصيدلي') !== -1 || t.indexOf('رد الدكتور') !== -1) return false;
  return true;
}
function holdSet_(cid, on) {
  var c = CacheService.getScriptCache();
  if (on) c.put('hold_' + cid, '1', 7200); else c.remove('hold_' + cid);
}
/* رد من تطبيق الواتساب: نفس الإمساك ٣٠ دقيقة. '1' = إمساك يدوي ساعتين — منقصرهوش. بيرجّع true لو الإمساك ابتدا دلوقتي. */
function holdEcho_(cid) {
  var c = CacheService.getScriptCache(), cur = c.get('hold_' + cid);
  if (cur === '1') return false;
  c.put('hold_' + cid, 'e', 1800);
  return !cur;
}
function holdKb_(cid, on) {
  return { inline_keyboard: [[ on ? { text: '▶️ رجّع البوت يرد', callback_data: 'h_off_' + cid }
                                  : { text: '🤫 أنا هرد (البوت يسكت)', callback_data: 'h_on_' + cid } ]] };
}

function namesAlign_(a, b) {
  var na = normalizeArabic(a), nb = normalizeArabic(b);
  if (!na || !nb) return false;
  if (na === nb || na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) {
    var s = Math.min(na.length, nb.length), l = Math.max(na.length, nb.length);
    return s >= 4 && s / l >= 0.45;
  }
  var ka = stockKey_(a), kb = stockKey_(b);
  return !!(ka && kb && (ka === kb || ka.indexOf(kb) !== -1 || kb.indexOf(ka) !== -1));
}
function resolveSummaryLines_(chatId, order) {
  var src = (order && order.lines) || [], lines = [], dropped = [];
  src.forEach(function (l) {
    var name = String(l.name || '').trim(), q = Math.max(1, parseInt(l.q, 10) || 1);
    if (!name) return;
    var hit = quotedFind_(chatId, name);
    if (!hit) {
      var found = searchStock(name).filter(function (it) { return !it.closeMatch; });
      if (found.length && namesAlign_(name, found[0].name)) hit = { name: found[0].name, price: Math.round(found[0].price) };
    }
    if (!hit) { dropped.push(name); return; }
    lines.push({ name: hit.name, q: q, price: Math.round(hit.price) });
  });
  return { lines: lines, dropped: dropped };
}
function matchFreshStock_(name, rows) {
  var n = normalizeArabic(name), k = stockKey_(name), i, rn;
  for (i = 0; i < rows.length; i++) {
    rn = normalizeArabic(rows[i].name);
    if (rn === n || rows[i].key === k) return rows[i];
  }
  for (i = 0; i < rows.length; i++) if (namesAlign_(name, rows[i].name)) return rows[i];
  return null;
}
function isExplicitConfirm_(text) {
  var n = normalizeArabic(text).replace(/\s+/g, ' ').trim();
  if (!n || n.length > 40) return false;
  return /^(اكد|اكد الطلب|تاكيد|تاكيد الطلب|موافق|موافق على الطلب|ايوه اكد|ايوا اكد|نعم اكد|تمام اكد|اوكي اكد|confirm|yes confirm)$/.test(n);
}
/* ملخص الأوردر قبل التسجيل. الحفظ نفسه بس في confirmPendingOrder_ بعد زرار التأكيد وإعادة فحص المخزون. */
function sendOrderSummary_(chatId, order) {
  if (holdBlocksBotSend_(chatId, 'ملخص')) return '';
  if (!order || !addressComplete_(order.address || '').ok) return '';
  if (!addressInDeliveryArea_(order.address || '').ok) return '';
  var resolved = resolveSummaryLines_(chatId, order);
  if (!resolved.lines.length) return '';
  var fee = deliveryFeeInfo_(), lines = [], total = 0;
  resolved.lines.forEach(function (l) {
    lines.push('• ' + l.name + ' × ' + l.q + ' = ' + (l.price * l.q) + ' جنيه');
    total += l.price * l.q;
  });
  var txt = '📦 ملخص طلب حضرتك:\n' + lines.join('\n') +
    (resolved.dropped.length ? '\n(اتشال لأنه مش متوفر دلوقتي: ' + resolved.dropped.join('، ') + ')' : '') +
    (total ? '\nإجمالي الأصناف: ' + total + ' جنيه' : '') +
    '\n' + fee.line +
    (fee.kind === 'fee' && total ? '\nالإجمالي: ' + (total + fee.n) + ' جنيه' : '') +
    '\nالعنوان: ' + String(order.address || '').replace(/\s*—?\s*https?:\S+/, '') +
    '\nالموبايل: ' + (order.phone || '—') +
    '\n\nالأوردر لسه متسجلش. نأكد الطلب؟';
  var sent = tgApi_('sendMessage', { chat_id: chatId, text: txt,
    reply_markup: { inline_keyboard: [[{ text: '✅ تأكيد الطلب', callback_data: 'o_ok' }, { text: '✏️ تعديل', callback_data: 'o_edit' }]] } });
  if (!sent || sent.ok === false) return '';
  CacheService.getScriptCache().put('pord_' + chatId, JSON.stringify({
    items: lines.join('\n') + (total ? '\nإجمالي الأصناف: ' + total + ' جنيه' : '') + '\n' + fee.line,
    lines: resolved.lines, phone: order.phone, address: order.address
  }), 7200);
  return txt;
}
function confirmPendingOrder_(chatId) {
  if (holdBlocksBotSend_(chatId, 'تأكيد')) return;
  var cch = CacheService.getScriptCache(), po = null;
  try { po = JSON.parse(cch.get('pord_' + chatId) || 'null'); } catch (e) {}
  if (!po || !po.lines || !po.lines.length) {
    cch.remove('pord_' + chatId);
    tgApi_('sendMessage', { chat_id: chatId, text: 'الملخص ده قديم. اكتب لحضرتك الطلب تاني وأبعتلك ملخص جديد.' });
    return;
  }
  var ac = addressComplete_(po.address || '');
  if (!ac.ok) {
    cch.remove('pord_' + chatId);
    tgApi_('sendMessage', { chat_id: chatId, text: addressAsk_(ac) });
    return;
  }
  if (!addressInDeliveryArea_(po.address || '').ok) {
    cch.remove('pord_' + chatId);
    var om = outOfAreaReply_();
    tgApi_('sendMessage', { chat_id: chatId, text: om });
    escalateToDoctor_(chatId, po.address, 'عنوان بره منطقة التوصيل');
    saveConversationTurn(chatId, '[أكد الطلب]', om);
    return;
  }
  var fresh = [];
  try { fresh = readStockRowsFresh_(); } catch (eF) { fresh = []; }
  /* قراية المخزون بطيئة. لو الصيدلي مسك الشات في النص، منسجلش الطلب ومنبعتش للعميل. */
  if (holdOn_(chatId)) return;
  var kept = [], dropped = [], priceChanged = false;
  po.lines.forEach(function (l) {
    var m = matchFreshStock_(l.name, fresh);
    if (!m || !(parseFloat(m.stock) > 0)) { dropped.push(l.name); return; }
    var price = Math.round(m.price);
    if (price !== Math.round(l.price)) priceChanged = true;
    kept.push({ name: m.name, q: Math.max(1, parseInt(l.q, 10) || 1), price: price });
  });
  if (!kept.length) {
    cch.remove('pord_' + chatId);
    var none = 'الأصناف دي خلصت من المخزون دلوقتي، فمش هقدر أسجّل الطلب. الدكتور هيكلم حضرتك هنا لو تحب نوفّرها.';
    tgApi_('sendMessage', { chat_id: chatId, text: none });
    escalateToDoctor_(chatId, po.lines.map(function (l) { return l.name; }).join('، '), 'تأكيد طلب والأصناف خلصت');
    saveConversationTurn(chatId, '[أكد الطلب]', none);
    return;
  }
  if (dropped.length || priceChanged) {
    var note = (dropped.length ? 'اتشال من الطلب لأنه مش متوفر دلوقتي: ' + dropped.join('، ') + '.' : '') +
      (priceChanged ? ' فيه سعر اتحدّث، راجع الملخص الجديد.' : '');
    tgApi_('sendMessage', { chat_id: chatId, text: note.trim() });
    var sum = sendOrderSummary_(chatId, { lines: kept, phone: po.phone, address: po.address });
    if (sum) saveConversationTurn(chatId, '[مستني تأكيد الطلب]', (note + '\n' + sum).trim());
    return;
  }
  cch.remove('pord_' + chatId);
  var fee = deliveryFeeInfo_(), total = 0;
  var itemsText = kept.map(function (l) { total += l.price * l.q; return '• ' + l.name + ' × ' + l.q + ' = ' + (l.price * l.q) + ' جنيه'; }).join('\n');
  itemsText += (total ? '\nإجمالي الأصناف: ' + total + ' جنيه' : '') + '\n' + fee.line;
  var ok = saveOrder_(chatId, itemsText, po.phone, po.address, true);
  var rr = ok ? 'تمام، الطلب اتسجل ووصل للصيدلية. هنتواصل مع حضرتك نأكد ميعاد التوصيل. شكرًا لحضرتك.'
              : 'حصلت مشكلة وإحنا بنسجل الطلب. الصيدلي هيتواصل مع حضرتك حالًا.';
  if (!ok) escalateToDoctor_(chatId, itemsText, 'فشل تسجيل الأوردر');
  delFlow_(chatId, null);
  tgApi_('sendMessage', { chat_id: chatId, text: rr });
  saveConversationTurn(chatId, '[أكد الطلب]', rr);
}
/* 🧪 وضع التجربة: والبوت واقف على الواتساب، أرقام التجربة بس بيرد عليها (آخر ١٠ أرقام). الافتراضي رقم الدكتور أحمد. */
function testNumbers_() {
  var v = PropertiesService.getScriptProperties().getProperty('BOT_TEST');
  if (v === null || v === undefined) return ['1120372238'];
  return String(v).split(',').filter(Boolean);
}
function testNumbersSet_(list) {
  var clean = (list || []).map(function (x) { return String(x).replace(/\D/g, '').slice(-10); }).filter(function (x) { return x.length >= 9; });
  PropertiesService.getScriptProperties().setProperty('BOT_TEST', clean.join(','));
}
function isTestChat_(cid) {
  if (!isWa_(cid)) return false;
  var d = String(cid).replace(/\D/g, '').slice(-10);
  return !!d && testNumbers_().indexOf(d) !== -1;
}
/* والبوت واقف: العميل ياخد رسالة واحدة "استلمنا" (مرة كل ساعة) بدل ما يفضل من غير أي رد.
   مفيش رسالة لو الصيدلي ماسك المحادثة (بيرد بنفسه). الجملة فيها "رد الصيدلي" عشان تعدّي من حاجز الإمساك. */
function pausedAck_(chatId) {
  try {
    if (!isWa_(chatId) || !botPaused_() || isTestChat_(chatId)) return;
    var c = CacheService.getScriptCache();
    if (c.get('hold_' + chatId) || c.get('ack_' + chatId)) return;
    c.put('ack_' + chatId, '1', 3600);
    var msg = 'استلمنا رسالة حضرتك 🌿 رد الصيدلي هيوصلك هنا في أقرب وقت.';
    var r = waSend_(String(chatId), msg);
    if (r && r.ok !== false) logChatRows_(chatId, [['bot', msg]]);
  } catch (e) { Logger.log('pausedAck_: ' + e.message); }
}
