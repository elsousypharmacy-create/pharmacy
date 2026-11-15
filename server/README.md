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
- `novaBridgeConfig` (doPost `{action, token, check?}`) — sets only `NOVA_WA_BRIDGE_URL` (fixed constant, never from the request) and `NOVA_WA_BRIDGE_TOKEN` (the request token) when the token's SHA-256 matches the committed `NOVA_WA_BRIDGE_TOKEN_SHA256` (hash only, no secret in git). `check: true` changes nothing. Returns `{ok, applied, urlSet, tokenSet}`, never the token; mismatch → `unauthorized`.

## Bot silence, test numbers, and inbound media (NOVA)
- `pausedAck_` is a no-op: the bot never sends the hourly «وصلتنا رسالتك» ack (or any other customer message from that path). Inbound logging and `novaWaForwardIn_` still run. Staff replies go only through `botReply` / bridge `reply`.
- `holdBlocksBotSend_` no longer lets a message through just because its text contains «رد الصيدلي» / «رد الدكتور». Staff sends set an explicit `_staff` flag (`botReply` → `tgApi_` → `waSend_`). Automatic/bot sends stay blocked while a chat is held, `BOT_AUTO_REPLY='0'`, or `BOT_PAUSED=1`.
- `BOT_TEST` — comma-separated last-10-digit test numbers that still get auto-replies when the bot is paused. If the property is unset or empty, there are **no** test numbers (the previous hard-coded default was removed).
- Inbound `image` / `sticker` / `audio` / `video` / `document`: GAS fetches the bytes from Graph (using `WA_TOKEN`, never logged) and forwards them to NOVA as `media_base64` plus `mime_type`, `filename`, `media_size`, `media_id`, and caption in `text`. Cap is 5 MB; larger files or fetch failures set `media_skipped` (`too_large` / `fetch_failed` / `no_url` / `no_token` / `bad_id`) and still forward the metadata + caption. A media failure never blocks the text/metadata forward. Text-only messages keep the previous payload shape (no new fields).
- After merge, the live Apps Script is updated from `server/Code.js` on `main` by `serverUpdate` / `autoServerUpdate` (dashboard «حدّث السيرفر», or the 15-minute trigger if auto-update is on). It writes a new version and points the **same** web-app deployment id at it, so the `/exec` URL does not change. If the project is at the 200-version limit, clear old versions in Project history first.
