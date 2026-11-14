# server/

- `src/NN_name.js` — the real source, split by topic. **Edit these.** Load order = `files.json` (file-name order). `00_config.js` must stay first (`secret_` is called eagerly by top-level vars).
- `Code.js` — GENERATED single-file bundle of `src/`. Do not edit by hand. The live updater (`serverUpdate`) fetches only this file from `main`.
- After editing `src/`: `node tools/build-server.js` (and `--check` to confirm it is current).
- `tools/verify-split.js <old Code.js> <acorn path>` proves the bundle is equivalent to a given single-file original.

## NOVA Rx WhatsApp forward + auto-reply switch (Script Properties)
All off by default: with these unset the bot behaves exactly as before.
- `NOVA_WA_BRIDGE_URL` — full URL of NOVA's `/api/v1/webhooks/whatsapp-bridge`. Inbound WhatsApp messages and the bot's own sent replies are POSTed there (`src/43_nova_wa_forward.js`), fire-and-forget, deduped by message id (6h), never throws or delays the customer reply.
- `NOVA_WA_BRIDGE_TOKEN` — at least 32 chars, same value as the NOVA secret of the same name. Sent as `Authorization: Bearer`, and also authenticates the `novaWhatsAppBridge` doPost action. Forwarding does nothing if URL or token is missing/short.
- `BOT_AUTO_REPLY` — `'0'` = automatic customer replies OFF; unset or anything else = ON. When off, messages are still logged, staff are still notified (same path as the pharmacist "hold"), and still forwarded to NOVA; only the automatic reply is skipped. Manual replies (`botReply`, bridge `reply`) still work; `/bottest` numbers keep getting replies, as with `BOT_PAUSED`. Toggle via `novaWhatsAppBridge` ops `autoReplyGet` / `autoReplySet` (`enabled: true|false`); changes apply within ~30s cache or immediately via the op.
