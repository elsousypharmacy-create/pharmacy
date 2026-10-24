// ==== MODULE 28_bot_handler (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 9) المعالج الرئيسي لرسالة العميل
// ===================================================================

function handleCustomerMessage(chatId, message) {
  const cache = CacheService.getScriptCache();

  try {
    // 📱 العميل شارك رقمه بالزرار — نتأكد إنه رقمه هو مش رقم حد تاني
    if (message.contact) {
      var ct = message.contact, own = ct.user_id && message.from && String(ct.user_id) === String(message.from.id);
      var vp = own ? canonicalEgyptPhone_(ct.phone_number) : '';
      if (own) {
        PropertiesService.getScriptProperties().setProperty('vphone_' + chatId, vp);
        saveCustomerPhone_(chatId, vp);
        CacheService.getScriptCache().remove('cname_' + vp);
      }
      if (holdOn_(chatId)) { heldSilence_(chatId, '[مشاركة رقم]' + (vp ? ' ' + vp : ''), message.date); return; }
      logChatRows_(chatId, [['user', '[مشاركة رقم]', message.date ? cairoStamp_(message.date) : '']]);
      if (own) {
        var pf = delFlow_(chatId);
        if (pf && pf.step === 'needPhone') {
          sendTelegramMarkup_(chatId, 'شكرًا لحضرتك، اتسجل رقم حضرتك ✅', { remove_keyboard: true });
          startDelivery_(chatId);
        } else sendWelcome_(chatId, '✅ شكرًا لحضرتك، اتسجل رقم حضرتك.');
      } else {
        sendTelegramMarkup_(chatId, 'معلش، محتاجين رقم حضرتك أنت، دوس على زرار "📱 سجّل رقمي" 🙏',
          KB_SHARE);
      }
      return;
    }

    // 📍 العميل بعت موقعه
    if (message.location) {
      logChatRows_(chatId, [['user', '[موقع]', message.date ? cairoStamp_(message.date) : '']]);
      var lf = delFlow_(chatId);
      var la = message.location.latitude, lo = message.location.longitude;
      var pn = placeName_(la, lo);
      if (holdOn_(chatId)) {
        tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, text: '📍 العميل بعت موقعه: ' + (pn || '') + '\n' + mapsLink_(la, lo) + '\n[#c' + chatId + ']' });
        return;
      }
      /* بعيد عن منطقة التوصيل؟ */
      var bsl = botSettings_(), cen = bsl.maxKm > 0 ? pharmacyCenter_() : null;
      if (cen) {
        var km = distKm_(cen.lat, cen.lng, la, lo);
        if (km > bsl.maxKm) {
          if (holdOn_(chatId)) {
            tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, text: '📍 العميل بعت موقعه: ' + (pn || '') + '\n' + mapsLink_(la, lo) + '\n[#c' + chatId + ']' });
            return;
          }
          tgApi_('sendMessage', { chat_id: chatId,
            text: '📍 الموقع ده' + (pn ? ' (' + pn + ')' : '') + ' بعيد عن منطقة التوصيل بتاعتنا (حوالي ' + Math.round(km) + ' كم من الصيدلية) 🙏\n' +
                  'ممكن حضرتك تبعت عنوان تاني جوه المنطقة، أو تكتب سؤالك والصيدلي يتواصل مع حضرتك.',
            reply_markup: { keyboard: [[{ text: '📍 ابعت موقعي', request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
          delFlow_(chatId, { step: 'address' });
          return;
        }
      }
      if (holdOn_(chatId)) {
        tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, text: '📍 العميل بعت موقعه: ' + (pn || '') + '\n' + mapsLink_(la, lo) + '\n[#c' + chatId + ']' });
        return;
      }
      if (lf && (lf.step === 'address' || lf.step === 'confirm')) addressConfirmed_(chatId, (pn ? pn + ' — ' : '') + mapsLink_(la, lo));
      else tgApi_('sendMessage', { chat_id: chatId, text: 'وصلنا موقع حضرتك ✅ تحب نوصّلك طلب؟', reply_markup: { inline_keyboard: [[{ text: '🛵 أيوه، أطلب توصيل', callback_data: 'm_del' }]] } });
      if (!(lf && (lf.step === 'address' || lf.step === 'confirm'))) delFlow_(chatId, { step: 'confirm', lat: la, lng: lo, place: pn });
      return;
    }

    // صور: بتتحول للدكتور
    if (message.photo) {
      /* الصورة نفسها بتتبعتلك (قبل كده كانت بتوصلك رسالة بس من غير الصورة) */
      tgApi_('forwardMessage', { chat_id: PERSONAL_CHAT, from_chat_id: chatId, message_id: message.message_id });
      var pfids = [message.photo[message.photo.length - 1].file_id];
      /* 🖼️ ألبوم (كذا صورة مع بعض): كل صورة بتوصل لوحدها — بنستنى ثواني ونجمّعهم،
         وأصغر رسالة في الألبوم هي اللي ترد مرة واحدة على الكل */
      if (message.media_group_id) {
        var MC = CacheService.getScriptCache(), gk = 'mg_' + message.media_group_id + '_', mid = message.message_id;
        MC.put(gk + mid, pfids[0], 600);
        if (message.caption) MC.put(gk + 'cap', String(message.caption), 600);
        Utilities.sleep(4000);
        var keys = []; for (var q = mid - 10; q <= mid + 10; q++) keys.push(gk + q);
        var got = MC.getAll(keys), ids = Object.keys(got).map(function (k) { return +k.slice(gk.length); }).sort(function (a, b) { return a - b; });
        if (ids.length && ids[0] !== mid) return;               /* صورة تانية في نفس الألبوم هترد */
        pfids = ids.map(function (n) { return got[gk + n]; });
        if (!message.caption) message.caption = MC.get(gk + 'cap') || '';
      }
      savePhotosForLog_(chatId, pfids);   /* الصور تتحفظ في Drive وتظهر في اللوحة */
      if (holdOn_(chatId)) {
        escalateToDoctor_(chatId, '[' + (pfids.length > 1 ? pfids.length + ' صور' : 'صورة') + ']' + (message.caption ? ' ' + message.caption : ''), 'صورة');
        saveConversationTurn(chatId, '[صورة]' + (message.caption ? ' ' + message.caption : ''), '[الصيدلي بيرد بنفسه]', 'bot', message.date);
        return;
      }
      /* 📷 البوت يقرا الصورة: علبة دوا → يرد بالتوافر والسعر · روشتة → المتوفر والإجمالي + تتبعتلك تراجعها */
      sendTelegram_(chatId, pfids.length > 1 ? 'استلمنا الصور (' + pfids.length + ') 🌿 ثواني وبنشوفها لحضرتك' : 'استلمنا الصورة 🌿 ثواني وبنشوفها لحضرتك');
      sendTypingAction_(chatId);
      var seen = readPhoto_(pfids);
      if (seen && seen.items && seen.items.length) {
        logChatRows_(chatId, [['sys', '📷 البوت قرأ (' + (seen.kind === 'prescription' ? 'روشتة' : 'علبة') + (seen.handwritten ? ' بخط الإيد' : '') + '): ' +
          seen.items.map(function (it) { return it.name + (it.strength ? ' ' + it.strength : '') + (it.sure === false ? ' (؟)' : ''); }).join('، ')]]);
      }
      /* ✍️ روشتة مكتوبة بخط الإيد → الصيدلي بس اللي يقراها ويرد (البوت ميخمّنش أسماء) */
      if (seen && seen.kind === 'prescription' && seen.handwritten) {
        var guess = (seen.items || []).map(function (it) { return it.name + (it.strength ? ' ' + it.strength : '') + (it.sure === false ? ' (؟)' : ''); }).join('، ');
        escalateToDoctor_(chatId, '[روشتة بخط الإيد — ' + (pfids.length > 1 ? pfids.length + ' صور فوق' : 'الصورة فوق') + ']' +
          (guess ? '\nقراية تقريبية من البوت (للمساعدة بس): ' + guess : '') + (message.caption ? '\nالعميل كتب: ' + message.caption : ''), '✍️ روشتة بخط الإيد — اقراها ورد على العميل');
        var rxUser = '[روشتة بخط الإيد' + (message.caption ? ': ' + message.caption : '') + ']';
        if (holdOn_(chatId)) { saveConversationTurn(chatId, rxUser, '[الصيدلي بيرد بنفسه]', 'bot', message.date); return; }
        var rr = 'استلمنا الروشتة 🌿 الصيدلي هيقراها بنفسه ويرد على حضرتك هنا بالمتوفر والأسعار في أقرب وقت.';
        logDeliveredTurn_(chatId, rxUser, rr, message.date, sendTelegram_(chatId, rr) !== false);
        return;
      }
      if (seen && (seen.kind === 'box' || seen.kind === 'prescription') && seen.items && seen.items.length) {
        var pnames = seen.items.map(function (it) { return it.name + (it.strength ? ' ' + it.strength : '') + (it.use ? ' (' + it.use + ')' : ''); }).join('، ');
        var ptxt = toAsciiDigits_(String(message.caption || '').trim()) || (seen.kind === 'prescription' ? 'عايز الروشتة دي' : 'عندكم الدوا ده؟');
        if (seen.kind === 'prescription')
          escalateToDoctor_(chatId, '[روشتة — الصورة فوق] قريت منها: ' + pnames + (message.caption ? '\nالعميل كتب: ' + message.caption : ''), 'روشتة — راجعها');
        PHOTO_CTX = seen;
        try { CacheService.getScriptCache().put('lastphoto_' + chatId, JSON.stringify({ kind: seen.kind, items: seen.items, rx: !!seen.rx, n: pfids.length }), 21600); } catch (eP) {}
        var okp = false;
        if (holdOn_(chatId)) { saveConversationTurn(chatId, '[صورة]' + (message.caption ? ' ' + message.caption : ''), '[الصيدلي بيرد بنفسه]', 'bot', message.date); return; }
        try { okp = smartCustomerReply_(chatId, ptxt + '\n[العميل بعت صورة ' + (seen.kind === 'prescription' ? 'روشتة' : 'منتج') + ' مكتوب فيها: ' + pnames + ']', getConversationHistory(chatId), message.date); } catch (e) {}
        PHOTO_CTX = null;
        if (okp) return;
      }
      escalateToDoctor_(chatId, '[صورة/روشتة — الصورة فوق الرسالة دي]' + (message.caption ? ' ' + message.caption : ''), 'صورة/روشتة');
      if (holdOn_(chatId)) { saveConversationTurn(chatId, '[صورة]', '[الصيدلي بيرد بنفسه]', 'bot', message.date); return; }
      const r = 'استلمنا الصورة 🌿 الصيدلي هيراجعها ويرد على حضرتك هنا في أقرب وقت.';
      logDeliveredTurn_(chatId, '[صورة]', r, message.date, sendTelegram_(chatId, r) !== false);
      return;
    }

    /* 🎤 فويس → كلام مكتوب، وبعدها يتعامل كأنه رسالة عادية */
    var fromVoice = false;
    if ((message.voice || message.audio) && !message.text) {
      /* واتساب واقف: منحوّلش الفويس لموديل. الصوت يتبعت للصيدلي والعميل مياخدش رد. تليجرام لسه بيتفهم. */
      if (isWa_(chatId) && botPaused_()) {
        try {
          var vblob = tgFileBlob_((message.voice || message.audio).file_id);
          if (vblob) UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendAudio', {
            method: 'post', muteHttpExceptions: true,
            payload: { chat_id: String(PERSONAL_CHAT), audio: vblob.setName('voice'),
              caption: '🎤 فويس واتساب\n[#c' + chatId + ']' } });
        } catch (eFv) {}
        heldSilence_(chatId, '[صوت]', message.date);
        try {
          PropertiesService.getScriptProperties().setProperty('escp_' + chatId, Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'));
          PropertiesService.getScriptProperties().deleteProperty('escr_' + chatId);
        } catch (eH) {}
        return;
      }
      var va = message.voice || message.audio;
      if ((va.duration || 0) > 180) {
        var longV = 'الرسالة الصوتية طويلة شوية 🙏 ممكن حضرتك تبعتها في رسايل أقصر (أقل من 3 دقايق) أو تكتبها.';
        logDeliveredTurn_(chatId, '[صوت طويل]', longV, message.date, sendTelegram_(chatId, longV) !== false);
        return;
      }
      sendTypingAction_(chatId);
      var heard = transcribeVoice_(va.file_id, va.mime_type || 'audio/ogg');
      if (!heard) {
        var badV = 'معلش الصوت مش واضح عندي 🙏 ممكن حضرتك تعيده أو تكتب طلبك؟';
        if (holdOn_(chatId)) tgApi_('forwardMessage', { chat_id: PERSONAL_CHAT, from_chat_id: chatId, message_id: message.message_id });
        logDeliveredTurn_(chatId, '[صوت]', badV, message.date, holdOn_(chatId) ? false : sendTelegram_(chatId, badV) !== false);
        return;
      }
      message = { text: heard, from: message.from, chat: message.chat, message_id: message.message_id, date: message.date };
      fromVoice = true;
    }

    var text = toAsciiDigits_((message.text || '').trim());
    if (!text) {
      if (holdOn_(chatId) && message && (message.document || message.video || message.video_note || message.sticker || message.animation)) {
        try { tgApi_('forwardMessage', { chat_id: PERSONAL_CHAT, from_chat_id: chatId, message_id: message.message_id }); } catch (eD) {}
        heldSilence_(chatId, message.document ? '[ملف]' : ((message.video || message.video_note) ? '[فيديو]' : '[ملصق]'), message.date);
      }
      return;
    }

    /* 🤫 الصيدلي ماسك المحادثة → الرسالة توصله والبوت ميردش */
    if (holdOn_(chatId)) {
      tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, reply_markup: holdKb_(chatId, true),
        text: '💬 ' + (getKnownCustomerName_(chatId) || 'العميل') + (fromVoice ? ' (فويس)' : '') + ':\n"' + text.slice(0, 2500) + '"\n\n↩️ اعمل Reply عشان ترد.\n[#c' + chatId + ']' });
      saveConversationTurn(chatId, text, '[الصيدلي بيرد بنفسه]', 'bot', message.date);
      try {
        PropertiesService.getScriptProperties().setProperty('escp_' + chatId, Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'));
        PropertiesService.getScriptProperties().deleteProperty('escr_' + chatId);
      } catch (eH) {}
      return;
    }

    if (text === '/start' || text === '/menu') { sendWelcome_(chatId); return; }

    /* أول رسالة أو تحية قصيرة → الترحيب المنظم بالأزرار */
    var nT0 = normalizeArabic(text);
    /* تحية بس (مفيش سؤال معاها) — "السلام عليكم عندكم بنادول" مش هتدخل هنا */
    if (hasAnyWord_(nT0, GREETING_WORDS_) && nT0.split(' ').length <= 4 && !extractProductLocally_(text)) {
      saveConversationTurn(chatId, text, '[رسالة الترحيب]', 'bot', message.date);
      sendWelcome_(chatId); return;
    }

    /* أسئلة الهوية ("اسمي ايه" / "انا مين" / "متسجل عندك") — بالكود مش بالموديل عشان ميخمّنش اسم */
    /* بنشيل علامات الاستفهام والحروف الفردية الزيادة ("اسمي ايه ز") */
    var nId = (' ' + normalizeArabic(text).replace(/[؟?!.،,]+/g, ' ') + ' ').replace(/\s\S(?=\s)/g, ' ').replace(/\s+/g, ' ').trim();
    if (/(اسمي (ايه|اي|اية)( |$)|(^| )انا مين|عارف(ني| انا مين| اسمي)|متسجل (عندك|عندكم|باسم|بايه)|انا متسجل)/.test(nId)) {
      var idName = getKnownCustomerName_(chatId);
      if (getVerifiedPhone_(chatId)) {
        tgApi_('sendMessage', { chat_id: chatId, text: idName
          ? 'حضرتك متسجل عندنا باسم: ' + idName + ' ✅'
          : 'رقم حضرتك متسجل عندنا ✅ بس الاسم لسه مش متسجل في السيستم. ممكن حضرتك تقولنا الاسم هنا 🌸' });
      } else {
        tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE,
          text: 'عشان نعرف بيانات حضرتك المسجلة، دوس على زرار "📱 سجّل رقمي" تحت بضغطة واحدة 🌸' });
      }
      saveConversationTurn(chatId, text, '[سؤال عن الهوية]', 'bot', message.date);
      return;
    }

    /* العنوان المكتوب لما بنستنى عنوان: لازم يبقى كامل، وجواه منطقة التوصيل لو القائمة متظبطة */
    var df0 = delFlow_(chatId);
    if (df0 && df0.step === 'address' && !extractPhone_(text)) {
      var looksAddr = text.length >= 6 || df0.partial || /\d|شارع|طريق|منطقة|عمارة|عماره|بجوار/.test(text);
      if (looksAddr) {
        var combined = ((df0.partial ? df0.partial + '، ' : '') + text).trim();
        var acA = addressComplete_(combined), arA = addressInDeliveryArea_(combined);
        if (acA.ok && !arA.ok) {
          var omA = outOfAreaReply_();
          sendTelegram_(chatId, omA);
          escalateToDoctor_(chatId, combined, 'عنوان بره منطقة التوصيل');
          saveConversationTurn(chatId, text, omA, 'bot', message.date);
          delFlow_(chatId, null);
          return;
        }
        if (!acA.ok) {
          delFlow_(chatId, { step: 'address', partial: combined });
          var askA = addressAsk_(acA);
          sendTelegram_(chatId, askA);
          saveConversationTurn(chatId, text, askA, 'bot', message.date);
          return;
        }
        addressConfirmed_(chatId, combined);
        return;
      }
    }

    /* كتب رقمه بإيده بس → منطلبش عنوان؛ التعرّف بالزرار */
    var onlyPhone = extractPhone_(text);
    if (onlyPhone && text.replace(/[\s+\-]/g, '').replace(/^(\+?2)?/, '').length <= 13 && !getVerifiedPhone_(chatId)) {
      saveCustomerPhone_(chatId, onlyPhone);
      tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE,
        text: 'شكرًا لحضرتك 🌸 لحماية بيانات حضرتك، التعرّف على الحساب بيتم بزرار "📱 سجّل رقمي" بضغطة واحدة.' });
      saveConversationTurn(chatId, text, '[طلبنا التسجيل بالزرار]', 'bot', message.date);
      return;
    }

    // تجميع الرسايل السريعة (متعطّل افتراضيًا عشان السرعة)
    if (MESSAGE_DEBOUNCE_MS > 0) {
      const stamp = String(new Date().getTime()) + Math.random();
      var pend = []; try { pend = JSON.parse(cache.get('pend_' + chatId) || '[]'); } catch (e) {}
      pend.push(text);
      cache.put('pend_' + chatId, JSON.stringify(pend.slice(-6)), 120);
      if (!cache.get('pend0_' + chatId) && message.date) cache.put('pend0_' + chatId, String(message.date), 120);
      cache.put('last_msg_' + chatId, stamp, 120);
      Utilities.sleep(MESSAGE_DEBOUNCE_MS);
      if (cache.get('last_msg_' + chatId) !== stamp) return;   /* جت رسالة أحدث — هي اللي هترد على الكل */
      try { pend = JSON.parse(cache.get('pend_' + chatId) || '[]'); } catch (e) { pend = [text]; }
      var at0 = cache.get('pend0_' + chatId);
      cache.remove('pend_' + chatId); cache.remove('pend0_' + chatId);
      if (at0) message.date = at0;
      if (pend.length > 1) text = pend.join('\n');
      /* الصيدلي ممكن يكون رد من الواتساب أثناء الانتظار */
      if (holdOn_(chatId)) {
        tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, reply_markup: holdKb_(chatId, true),
          text: '💬 ' + (getKnownCustomerName_(chatId) || 'العميل') + ':\n"' + text.slice(0, 2500) + '"\n\n↩️ اعمل Reply عشان ترد.\n[#c' + chatId + ']' });
        saveConversationTurn(chatId, text, '[الصيدلي بيرد بنفسه]', 'bot', message.date);
        return;
      }
    }
    if (cache.get('pord_' + chatId) && isExplicitConfirm_(text)) { confirmPendingOrder_(chatId); return; }

    sendTypingAction_(chatId);

    const phone = extractPhone_(text);
    if (phone) saveCustomerPhone_(chatId, phone);

    const history = getConversationHistory(chatId);
    const nText = normalizeArabic(text);

    // --- 🧠 العقل الجديد: خط أحمر صغير، والباقي الموديل بيفهمه من السياق ---
    if (SMART_BRAIN) {
      for (var hk = 0; hk < HARD_ESCALATE.length; hk++) {
        if (nText.indexOf(normalizeArabic(HARD_ESCALATE[hk])) !== -1) {
          escalateToDoctor_(chatId, text, 'كلمة تستدعي مراجعة: ' + HARD_ESCALATE[hk]);
          const rhs = ['ألف سلامة على حضرتك 🌸 في الحالة دي لازم الصيدلي يراجع بنفسه، بلّغته برسالة حضرتك وهيرد هنا في أقرب وقت.',
                       'عشان سلامة حضرتك وسلامة البيبي، الصيدلي هو اللي هيرد على حضرتك بنفسه 🙏 وصّلتله السؤال دلوقتي.',
                       'حاضر، دي محتاجة رأي الصيدلي شخصيًا. وصّلتله سؤال حضرتك وهيرد هنا قريب جدًا 🌸'];
          const rh = rhs[Math.floor(Math.random() * rhs.length)];
          sendTelegram_(chatId, rh);
          saveConversationTurn(chatId, text, rh, 'bot', message.date);
          return;
        }
      }
      var drugW = keywordHit_(nText, CONTROLLED_DRUGS_);
      if (drugW) {
        var rd = 'الدوا ده من أدوية الجدول ومش بنقدر نصرفه ولا نسعّره من الشات. الدكتور هيكلم حضرتك هنا في أقرب وقت.';
        escalateToDoctor_(chatId, text, 'دوا جدول: ' + drugW);
        logDeliveredTurn_(chatId, text, rd, message.date, sendTelegram_(chatId, rd) !== false);
        return;
      }
      var compW = keywordHit_(nText, COMPLAINT_MARKERS_);
      if (compW) {
        var rcpl = 'معلش يا حضرتك، وآسفين على اللي حصل. الدكتور هيكلم حضرتك هنا في أقرب وقت.';
        escalateToDoctor_(chatId, text, 'شكوى: ' + compW);
        logDeliveredTurn_(chatId, text, rcpl, message.date, sendTelegram_(chatId, rcpl) !== false);
        return;
      }
      try { safetyCapture_(chatId, text, history); } catch (e) {}
      if (smartCustomerReply_(chatId, text, history, message.date)) return;
      if (holdOn_(chatId)) { heldSilence_(chatId, text, message.date); return; }

      /* العقل مقدرش يرد: منرجعش للنظام القديم (كان بيدوّر على جملة العميل كأنها اسم دوا ويقول "مش متوفر").
         لو الكلام اسم صنف موجود → نرد بالسعر من المخزون؛ غير كده → رد مهذب وبلاغ للصيدلي. */
      var fbProd = extractProductLocally_(text), fbRes = fbProd && fbProd.length >= 3 ? searchStock(fbProd) : [];
      if (fbRes.length) {
        var fbAns = buildProductAnswer_(fbRes, fbProd);
        if (!fbAns.available) {
          escalateToDoctor_(chatId, text, 'مش متوفر: ' + fbProd);
          logDeliveredTurn_(chatId, text, fbAns.text, message.date, sendTelegram_(chatId, fbAns.text) !== false);
          return;
        }
        logQuote_(chatId, fbAns.items || []); quotedAdd_(chatId, fbAns.items || []);
        logDeliveredTurn_(chatId, text, fbAns.text, message.date, sendTelegram_(chatId, fbAns.text) !== false);
        return;
      }
      var fbMiss = productAskMiss_(text);
      if (fbMiss) {
        escalateToDoctor_(chatId, text, 'مش متوفر: ' + fbMiss);
        logDeliveredTurn_(chatId, text, PRODUCT_MISSING_REPLY_, message.date, sendTelegram_(chatId, PRODUCT_MISSING_REPLY_) !== false);
        return;
      }
      escalateToDoctor_(chatId, text, 'البوت مقدرش يرد — يفضّل ترد بنفسك');
      var fbs = ['ثواني وأرجع لحضرتك بالرد 🙏', 'وصلت رسالة حضرتك، الصيدلي هيرد على حضرتك هنا في أقرب وقت 🌸',
                 'تمام، بنراجع طلب حضرتك وهنرد هنا حالًا 🙏'];
      var fb = fbs[Math.floor(Math.random() * fbs.length)];
      logDeliveredTurn_(chatId, text, fb, message.date, sendTelegram_(chatId, fb) !== false);
      return;
    }

    // --- خط أحمر: كلمات بتحوّل للدكتور فورًا ---
    for (var k = 0; k < ESCALATE_KEYWORDS.length; k++) {
      if (nText.indexOf(normalizeArabic(ESCALATE_KEYWORDS[k])) !== -1) {
        escalateToDoctor_(chatId, text, 'كلمة تستدعي مراجعة: ' + ESCALATE_KEYWORDS[k]);
        const r = 'سؤالك ده محتاج رأي الدكتور شخصيًا 🙏 حوّلته له دلوقتي وهيرد عليك بنفسه هنا.';
        logDeliveredTurn_(chatId, text, r, message.date, sendTelegram_(chatId, r) !== false);
        return;
      }
    }

    // --- نية طلب/توصيل ---
    if (hasAnyWord_(nText, ORDER_WORDS_) || phone) {
      handleOrderIntent_(chatId, text, history, message.date);
      return;
    }

    // --- ⚡ الرد المحلي السريع: تحية / صنف / سعر / نقاط ---
    const quick = tryLocalReply_(chatId, text, history);
    if (quick) {
      logDeliveredTurn_(chatId, text, quick, message.date, sendTelegram_(chatId, quick) !== false);
      return;
    }

    // --- مفهمناش محليًا: نجرب الذكاء الاصطناعي ---
    const cls = classifyCustomerMessage(text, history);

    if (cls.type === 'MEDICAL') {
      escalateToDoctor_(chatId, text, 'سؤال طبي');
      const r = 'سؤالك محتاج رأي الدكتور 🙏 حوّلته له وهيرد عليك بنفسه هنا.';
      logDeliveredTurn_(chatId, text, r, message.date, sendTelegram_(chatId, r) !== false);
      return;
    }

    if (cls.type === 'PRODUCT' && cls.product) {
      handleProductQuery_(chatId, text, cls.product, history, message.date);
      return;
    }

    if (cls.type === 'ORDER') {
      handleOrderIntent_(chatId, text, history, message.date);
      return;
    }

    // --- كلام عام: نحاول نصيغ رد، ولو فشل منسيبش العميل ---
    const nm = getKnownCustomerName_(chatId);
    var reply = null;

    if (cls.type !== 'FAILED') {
      const genPrompt = formatHistory(history) +
        'انت مساعد ' + PHARMACY_NAME + '، بترد بالعامية المصرية بشكل ودود ومختصر (سطرين بالكتير).\n' +
        'قواعد مهمة:\n' +
        '- متذكرش أي أسعار ولا أسماء أصناف ولا تقول إن حاجة متوفرة أو مش متوفرة.\n' +
        '- متقولش إنك سجلت أو عملت أوردر أو هتطلع عنوان من السيستم.\n' +
        '- متكررش "تحت أمرك" لو قلتها قبل كده.\n' +
        (nm ? '- اسم العميل: ' + nm + '\n' : '') +
        '\nالرسالة: "' + text + '"';
      reply = callGemini(genPrompt);
      if (reply && replyHasInventedNumbers_(reply, [])) reply = null;
    }

    if (!reply) {
      // جيميني واقع — نرد رد محترم ونحوّل، مش نقول "ضغط على النظام"
      reply = 'تحت أمرك يا فندم 🌸 قولي اسم الصنف اللي محتاجه وأقولك متوفر ولا لأ وبكام.';
      escalateToDoctor_(chatId, text, 'الذكاء الاصطناعي مردش — يفضّل ترد بنفسك');
    }

    logDeliveredTurn_(chatId, text, reply, message.date, sendTelegram_(chatId, reply) !== false);

  } catch (e) {
    Logger.log('خطأ handleCustomerMessage: ' + e.message);
    try {
      escalateToDoctor_(chatId, (message.text || '[رسالة]'), 'خطأ تقني: ' + e.message);
      sendTelegram_(chatId, 'ثانية واحدة يا فندم 🙏 الدكتور هيرد عليك حالًا.');
    } catch (e2) {}
  }
}

// --- سؤال عن صنف ---
function handleProductQuery_(chatId, text, product, history, arrivalUnix) {
  if (holdOn_(chatId)) { heldSilence_(chatId, text, arrivalUnix); return; }
  const results = searchStock(product);

  if (!results.length) {
    logUnavailableRequest_(chatId, product);
    escalateToDoctor_(chatId, text, 'مش متوفر: ' + product);
    logDeliveredTurn_(chatId, text, PRODUCT_MISSING_REPLY_, arrivalUnix, sendTelegram_(chatId, PRODUCT_MISSING_REPLY_) !== false);
    return;
  }

  const answer = buildProductAnswer_(results, product);
  if (!answer.available) {
    escalateToDoctor_(chatId, text, 'مش متوفر: ' + product);
    logDeliveredTurn_(chatId, text, answer.text, arrivalUnix, sendTelegram_(chatId, answer.text) !== false);
    return;
  }
  logQuote_(chatId, answer.items || []);

  // نخلي المودل يصيغ جملة تقديم بس — من غير أي أرقام
  const nm = getKnownCustomerName_(chatId);
  const wrapPrompt = formatHistory(history) +
    'انت مساعد ' + PHARMACY_NAME + '. اكتب جملة واحدة قصيرة جدًا بالعامية المصرية تقدّم بيها النتيجة دي للعميل.\n' +
    'ممنوع تمامًا: تكتب أي رقم، أو أي سعر، أو أي اسم صنف، أو تزود معلومة من عندك.\n' +
    'جملة ترحيبية/تمهيدية بس، وبعدها هنلزق النتيجة تحتها.\n' +
    (nm ? 'اسم العميل: ' + nm + '\n' : '') +
    'العميل سأل عن: "' + product + '"\n' +
    'النتيجة: ' + (answer.available ? 'متوفر' : 'مش متوفر');

  var intro = callGemini(wrapPrompt);
  if (!intro || replyHasInventedNumbers_(intro, []) || intro.length > 120) intro = '';

  const finalReply = (intro ? intro.trim() + '\n\n' : '') + answer.text;
  if (holdOn_(chatId) || sendTelegram_(chatId, finalReply) === false) { heldSilence_(chatId, text, arrivalUnix); return; }
  saveConversationTurn(chatId, text, finalReply, 'bot', arrivalUnix);
}

function linesFromHistory_(chatId, history) {
  var lines = [], blob = '';
  for (var i = (history || []).length - 1; i >= 0; i--) {
    if (history[i].role === 'bot' && String(history[i].text || '').indexOf('•') !== -1) { blob = history[i].text; break; }
  }
  String(blob).split('\n').forEach(function (row) {
    var m = String(row).match(/^[•\-]\s*(.+?)(?:\s*[×x]\s*(\d+))?(?:\s*=|$)/);
    if (!m) return;
    var name = m[1].replace(/\d+\s*جنيه.*/, '').trim();
    if (name.length < 2) return;
    lines.push({ name: name, q: parseInt(m[2], 10) || 1 });
  });
  if (lines.length) return lines;
  try {
    JSON.parse(CacheService.getScriptCache().get('quoted_' + chatId) || '[]').slice(-8).forEach(function (it) {
      if (it && it.name) lines.push({ name: it.name, q: 1, price: it.price });
    });
  } catch (e) {}
  return lines;
}
// --- نية الطلب/التوصيل: ملخص ثم تأكيد. الحفظ مش هنا. ---
function handleOrderIntent_(chatId, text, history, arrivalUnix) {
  if (holdOn_(chatId)) { heldSilence_(chatId, text, arrivalUnix); return; }
  const phone = getCustomerPhone_(chatId) || extractPhone_(text);
  if (phone) saveCustomerPhone_(chatId, phone);
  function say(r) {
    if (holdOn_(chatId) || sendTelegram_(chatId, r) === false) { heldSilence_(chatId, text, arrivalUnix); return false; }
    saveConversationTurn(chatId, text, r, 'bot', arrivalUnix);
    return true;
  }
  if (!phone) {
    say('تمام يا فندم. ابعت لحضرتك رقم الموبايل والعنوان كامل (المنطقة والشارع وعلامة مميزة) عشان أجهز الملخص.');
    return;
  }
  var lines = linesFromHistory_(chatId, history);
  if (!lines.length) {
    say('تمام، الرقم وصل. اكتب لحضرتك اسم الصنف والكمية عشان أراجع التوفر وأبعتلك الملخص.');
    return;
  }
  const addressGuess = text.replace(/01[0125]\d{8}/g, '').trim();
  var ac = addressComplete_(addressGuess);
  if (!ac.ok) { say(addressAsk_(ac)); return; }
  if (!addressInDeliveryArea_(addressGuess).ok) {
    if (say(outOfAreaReply_()) !== false) escalateToDoctor_(chatId, addressGuess, 'عنوان بره منطقة التوصيل');
    return;
  }
  if (holdOn_(chatId)) { heldSilence_(chatId, text, arrivalUnix); return; }
  var sum = sendOrderSummary_(chatId, { lines: lines, phone: phone, address: addressGuess });
  if (holdOn_(chatId)) { heldSilence_(chatId, text, arrivalUnix); return; }
  if (!sum) {
    say('الأصناف دي مش ظاهرة متوفرة في المخزون دلوقتي، فمش هقدر أجهز ملخص. الدكتور هيكلم حضرتك هنا.');
    escalateToDoctor_(chatId, lines.map(function (l) { return l.name; }).join('، '), 'طلب وأصناف مش متوفرة');
    return;
  }
  saveConversationTurn(chatId, text, sum, 'bot', arrivalUnix);
}