// ==== MODULE 22_handoff (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 2) تحويل السؤال للدكتور والرد عليه
// ===================================================================

// بيبعتلك السؤال ومعاه علامة مخفية فيها رقم شات العميل
function clearHandoff_(chatId) {
  if (!chatId || badChatId_(chatId)) return;
  var P = PropertiesService.getScriptProperties();
  P.deleteProperty('escp_' + chatId);
  P.deleteProperty('escmid_' + chatId);
  P.deleteProperty('escr_' + chatId);
}
function escalateToDoctor_(customerChatId, customerText, reason) {
  if (badChatId_(customerChatId)) { noteBadChatId_('escalate', customerChatId, reason); return; }
  const name = getKnownCustomerName_(customerChatId);
  const who = name ? (name + ' ') : '';
  const vph = getVerifiedPhone_(customerChatId);
  const txt = '⚕️ سؤال محتاج ردك\n' + SEP + '\n' +
    who + (vph ? '📱 ' + vph + ' ' : '') + '(chat: ' + customerChatId + ')\n' +
    'السبب: ' + reason + '\n\n' +
    '"' + String(customerText || '').slice(0, 2500) + '"\n\n' +
    '↩️ اعمل Reply على الرسالة دي وأنا هوصّل ردك للعميل.\n' +
    '[#c' + customerChatId + ']';
  var PR = PropertiesService.getScriptProperties();
  try {   /* لو فيه تنبيه لنفس العميل لسه من غير رد (آخر 15 دقيقة): بنضيف الرسالة الجديدة عليه بدل تنبيه جديد */
    var st = JSON.parse(PR.getProperty('escmid_' + customerChatId) || 'null');
    var urgent = /🚨|صورة|روشتة/.test(String(reason));
    if (st && st.mid && !urgent && PR.getProperty('escp_' + customerChatId) && (Date.now() - st.at) < 15 * 60000) {
      var nt = st.txt + '\n➕ ' + Utilities.formatDate(new Date(), 'Africa/Cairo', 'HH:mm') + ' — "' + String(customerText || '').slice(0, 300) + '"  (' + reason + ')';
      if (nt.length < 3800) {
        var er = tgApi_('editMessageText', { chat_id: PERSONAL_CHAT, message_id: st.mid, text: nt, reply_markup: holdKb_(customerChatId, holdOn_(customerChatId)) });
        if (er && er.ok) {
          st.txt = nt; PR.setProperty('escmid_' + customerChatId, JSON.stringify(st));
          logChatRows_(customerChatId, [['sys', '⚕️ اتضاف لنفس التنبيه — ' + reason]]);
          return;
        }
      }
    }
  } catch (eM) {}
  const r = tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, text: txt, reply_markup: holdKb_(customerChatId, holdOn_(customerChatId)) });
  try { if (r && r.ok && r.result) PR.setProperty('escmid_' + customerChatId, JSON.stringify({ mid: r.result.message_id, at: Date.now(), txt: txt })); } catch (eS) {}
  try {   /* 🔴 محتاج رد — بيظهر في صفحة المحادثات لحد ما ترد */
    PropertiesService.getScriptProperties().setProperty('escp_' + customerChatId, Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'));
    PropertiesService.getScriptProperties().deleteProperty('escr_' + customerChatId);
    logChatRows_(customerChatId, [['sys', '⚕️ اتحوّل للصيدلي — ' + reason]]);
  } catch (eL) {}
  if (!r || !r.ok) sendTelegramStaff(txt, PERSONAL_CHAT);
}

// لما تعمل Reply، بناخد ردك ونبعته للعميل باسم الصيدلية
function relayDoctorReply_(msg) {
  try {
    const original = msg.reply_to_message.text || '';
    const m = original.match(/\[#c(-?\d+|wa_[\w.]+)\]/);
    if (!m) return false;

    const customerChatId = m[1];
    const doctorText = (msg.text || '').trim();
    if (!doctorText) return false;

    sendTelegramStaff('👨‍⚕️ رد الدكتور:\n\n' + doctorText, customerChatId);
    saveConversationTurn(customerChatId, '[سؤال محوّل للدكتور]', doctorText, 'pharm');
    clearHandoff_(customerChatId);
    sendTelegramStaff('✅ اتبعت للعميل.', PERSONAL_CHAT);
    return true;
  } catch (e) {
    Logger.log('خطأ relayDoctorReply_: ' + e.message);
    return false;
  }
}