/* NOVA Rx WhatsApp adapter. Inactive unless NOVA_WA_BRIDGE_TOKEN is configured. */
function novaWaAuthorized_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('NOVA_WA_BRIDGE_TOKEN') || '';
  token = String(token || '');
  if (expected.length < 32 || token.length !== expected.length) return false;
  var mismatch = 0;
  for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return mismatch === 0;
}
function novaWaBridge_(d) {
  if (!novaWaAuthorized_(d.bridgeToken)) return { ok: false, error: 'unauthorized' };
  var op = String(d.operation || '');
  if (op === 'autoReplyGet') return { ok: true, autoReply: !botAutoReplyOff_() };
  if (op === 'autoReplySet') {
    if (typeof d.enabled !== 'boolean') return { ok: false, error: 'invalid enabled' };
    botAutoReplySet_(d.enabled);
    return { ok: true, autoReply: !botAutoReplyOff_() };
  }
  var id = String(d.chatId || '');
  if (op === 'list') {
    var r = getBotChats();
    return { ok: true, chats: (r.chats || []).filter(function(c) { return /^wa_[A-Za-z0-9_.-]{1,100}$/.test(c.id); }) };
  }
  if (!/^wa_[A-Za-z0-9_.-]{1,100}$/.test(id)) return { ok: false, error: 'invalid chat' };
  if (op === 'get') return getBotChat(id);
  if (op === 'reply') {
    var message = String(d.text || '').trim();
    if (!message || message.length > 4000) return { ok: false, error: 'invalid message' };
    // Send through the existing WhatsApp-aware Telegram adapter, preserving Meta's response.
    // The existing botReply() saves the conversation only after confirmed delivery.
    return botReply(id, message);
  }
  if (op === 'hold') {
    if (typeof d.hold !== 'boolean') return { ok: false, error: 'invalid hold' };
    return botHold(id, d.hold);
  }
  return { ok: false, error: 'unsupported operation' };
}
