# تسليم المشروع — صيدلية د. أحمد السوسي (محلة كيل، مصر)

Read this first when you start a new session on this repo. It has **no secrets**: never add keys, PINs, tokens or customer names to this file or anywhere in the repo (it is public).

## Who and how to talk
- Owner: Ahmed Elsousy, pharmacist, manages the pharmacy **remotely from Saudi Arabia**. Reply in **short Egyptian Arabic**, outcome first, no long explanations.
- Standing rules: **tell him the plan first and agree before building anything big** (small fixes he asks for are fine). Never ask for passwords/tokens in chat (he enters them in the dashboard). Commit straight to `main`. Don't touch the delivery system.
- He reads on a phone: keep answers compact; show what you tested.

## Architecture
- **Server:** Google Apps Script web app. Source in `server/src/NN_*.js` (load order = `server/files.json`); `server/Code.js` is GENERATED. After editing run `node tools/build-server.js` then `node tools/build-server.js --check`. Never edit `Code.js` by hand.
- **Dashboard:** `index.html` (vanilla JS, GitHub Pages: https://elsousypharmacy-create.github.io/pharmacy/index.html). Changes show ~2 min after push. Admin actions need the PIN (`ADMIN_ACTIONS` in both `index.html` and `server/src/05_routing.js`).
- **Server updates:** the dashboard button «🔄 حدّث السيرفر» (or the auto-update trigger, every 15 min, which waits 10 min for the code to settle) pulls `server/Code.js` from GitHub and installs it. **Google caps a project at 200 versions** and every update uses one; the dashboard shows N/200 and warns at 170. There is no API to delete versions: delete old ones by hand at script.google.com → Project history (keep the newest ~20 and the deployed one).
- **Cloudflare Worker** `worker/worker.js`: cache layer in front of Apps Script (read endpoints, stale up to 6 h). It is pasted by hand by Ahmed; the connector can't edit it.
- **Data sources (Google Drive):** POS export files in the sales folder (`sales<date>.txt`, `Returnsales<date>.txt`, `debits<date>.txt`), the POS daily-stats sheet, the POS closing PDFs (daily and per shift), camera frames.

## What exists (built recently)
- **الديون:** list by age buckets with search; one card per customer even if the phone changed (merge by customer id, or by name + balance); credits (customers who have money with us); negative balances handled; last payment, seller, per-employee totals. SMS debt reminders are **switched off** (`DEBT_SMS_ENABLED = false`).
- **الميزانية:** assets/liabilities from the POS daily report (net debt, stock at cost, company claims, agent commissions) + numbers Ahmed enters (cash, bank, salaries), and a saved starting point.
- **التقفيل:** day-by-day sales by payment method (POS codes: 1 = cash, 2 = credit, 3 = bank card), returns, collections, expected drawer cash. The server **reads the POS closing PDFs itself** (`server/src/69_closing_pdf.js`: inflate + text cells) and reconciles them with the invoices (they match to the cent) plus the counted-vs-system differences per day and per shift. Days collapse; checkboxes + «مشاركة PDF»; period picker in the calendar button / menu (default = current month).
- **Cameras:** `camAutoSnap` captures cameras 1, 2, 3, 4, 6 every 10 min (08:00–01:00 Cairo) into the camera Drive folder. Reports are JSON in the «تقارير» Drive folder, drawn by the dashboard (التقارير). Recipe: `tools/camera-day-report.md`; skill copy: `tools/skills/elsousy-camera-report/SKILL.md`.
- Dashboard shows a red dot on the server-refresh button when a server update or the version limit needs attention.

## Camera reports: how they run
**Status:** current recipe = `tools/camera-day-report.md` (what the tasks run). The redesign (all inside frames, outside every 30 min, 4×3 grids, midnight run split in two) is staged in `tools/camera-day-report-next.md`, **not active**: Ahmed wants the current tasks/settings kept until his usage renews. Activate by copying `-next` over the active file.
Two scheduled tasks (Claude routines, Cairo time): «تقرير الكاميرات — الضهر» 12:04 and «— الليل» 00:04. Each reads the recipe in this repo, reviews the frames, writes the JSON to Drive. They need the **Google Drive connector** and run on the **usage of the account that created them**. The older task «تقرير الكاميرات التلقائي» (10:36 / 22:36) looks at one frame and should be paused.

## Manual entrance-video probe (2026-11-01)
- Security prerequisite: removed the fixed WhatsApp verification-token fallback from module 21; missing `WA_VERIFY` is now generated randomly in Script Properties. Existing saved values are preserved. Worker code is unchanged.
- Settings → Cameras: «اختبار فيديو المدخل — دقيقة». Authenticated POST `camVideoTest` only; uses existing server-side credentials, targets recorder channel **4** after exact serial/channel resource discovery.
- New source: `server/src/66_cam_video.js`. Requests live **fluent/sub-stream** HLS, then checks EZOPEN availability if no HTTPS HLS address is available. Fluent does **not** imply a fixed 256 kbps bitrate.
- HLS signed playback URL goes only to the authenticated owner's browser in memory; API key, secret, SDK tokens and raw provider errors never return. No links/tokens in logs, reports, GitHub, local storage or messages. No encryption settings are changed.
- Native HLS browsers (e.g. Safari on iPhone) can attempt playback. Client stops after 60 seconds, on explicit stop, page hide or removal of the player. Other browsers get an honest unsupported-player message. An address alone is **not** verified playback, connection stability, bandwidth measurement or AI accuracy. EZOPEN requires the official SDK; this probe does not integrate it.
- No live account test has been performed from the coding environment (no admin PIN/session). After server update, Ahmed runs the button and shares **only the visible status/error code**, never a playback URL or token. Existing snapshot schedule and report recipe remain active as before.
- Validation: `node tools/test-camera-video.js`, server build/check + JS syntax. Browser playback was not tested here: Chromium is absent and its download failed. The actual Safari/live-stream check remains pending with Ahmed.

## Open items
1. **Hourly zip bundles for camera frames** (so a report session downloads ~1 file per hour instead of ~20): need to learn the Drive connector's max download size first (a 6.7 MB file crashed the connection). Plan: a small server function that makes 3 test zips (~1, 2, 4 MB), then an hourly trigger that builds the real bundles and deletes them after 3 days. Not built yet — agree with Ahmed before building; he presses «حدّث السيرفر» after any server change.
2. Pause the old camera task (he has to do it in claude.ai).
3. Pending decision: whether the dashboard should show counted-vs-system closing differences as alerts (Telegram) above a threshold.
4. Move to the new account: recreate the two camera tasks, reconnect Google Drive with the pharmacy's Google account, re-upload the camera skill from `tools/skills/`.

## How to test without the live server
- Server logic: load `server/Code.js` in a Node `vm` with small mocks of `DriveApp`, `PropertiesService`, `CacheService`, `Utilities`, `SpreadsheetApp`; feed real POS file text.
- Dashboard: Playwright (Chromium is installed) opening `index.html` with `page.route` mocking the Apps Script URL; check screenshots. jsPDF is loaded from cdnjs in the app (can be mocked from npm `jspdf@2.5.1`).
- Always run the build check and a syntax check of the `<script>` blocks before pushing.

## Things learned the hard way
- POS Arabic PDFs use presentation forms in visual (reversed) order: normalize NFKC after reversing the string.
- The Drive connector saves downloads bigger than ~45 KB to a file (base64 inside JSON); smaller ones come back inline.
- Never put full-resolution images through a chat tool unverified; check the byte size equals Drive's `fileSize`.

