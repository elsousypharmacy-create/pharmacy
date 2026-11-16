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
/* One-shot remote config of the two NOVA bridge Script Properties. Only the SHA-256 of the token is committed. */
var NOVA_WA_BRIDGE_URL_FIXED = 'https://nova-rx-api-staging.elsousypharmacy.workers.dev/api/v1/webhooks/whatsapp-bridge';
var NOVA_WA_BRIDGE_TOKEN_SHA256 = '06b8e639b261e56744fd8da6c11f06ed19657148d118fe7e7b2108e57672859a';
function novaSha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return hex;
}
function novaBridgeConfig_(d) {
  try {
    var token = d && d.token;
    if (typeof token !== 'string' || token.length < 32) return { ok: false, error: 'unauthorized' };
    var got = novaSha256Hex_(token), want = NOVA_WA_BRIDGE_TOKEN_SHA256;
    var mismatch = got.length ^ want.length;
    for (var i = 0; i < want.length; i++) mismatch |= want.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
    if (mismatch !== 0) return { ok: false, error: 'unauthorized' };
    var P = PropertiesService.getScriptProperties();
    var apply = d.check !== true;
    if (apply) {
      P.setProperty('NOVA_WA_BRIDGE_URL', NOVA_WA_BRIDGE_URL_FIXED);
      P.setProperty('NOVA_WA_BRIDGE_TOKEN', token);
    }
    return { ok: true, applied: apply, urlSet: P.getProperty('NOVA_WA_BRIDGE_URL') === NOVA_WA_BRIDGE_URL_FIXED, tokenSet: novaWaAuthorized_(token) };
  } catch (e) {
    return { ok: false, error: 'config failed' };
  }
}
