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
- **Cloudflare Worker** `worker/worker.js`: cache layer in front of Apps Script (read endpoints, stale up to 6 h). It can be deployed through the connected Cloudflare plugin; see the latest verified deployment checkpoint below.
- **Data sources (Google Drive):** POS export files in the sales folder (`sales<date>.txt`, `Returnsales<date>.txt`, `debits<date>.txt`), the POS daily-stats sheet, the POS closing PDFs (daily and per shift), camera frames.

## What exists (built recently)
- **الديون:** list by age buckets with search; one card per customer even if the phone changed (merge by customer id, or by name + balance); credits (customers who have money with us); negative balances handled; last payment, seller, per-employee totals. SMS debt reminders are **switched off** (`DEBT_SMS_ENABLED = false`).
- **الميزانية:** assets/liabilities from the POS daily report (net debt, stock at cost, company claims, agent commissions) + numbers Ahmed enters (cash, bank, salaries), and a saved starting point.
- **التقفيل:** day-by-day sales by payment method (POS codes: 1 = cash, 2 = credit, 3 = bank card), returns, collections, expected drawer cash. The server **reads the POS closing PDFs itself** (`server/src/69_closing_pdf.js`: inflate + text cells) and reconciles them with the invoices (they match to the cent) plus the counted-vs-system differences per day and per shift. Days collapse; checkboxes + «مشاركة PDF»; period picker in the calendar button / menu (default = current month).
- **Cameras:** `camAutoSnap` captures cameras 1, 2, 3, 4, 6 every 10 min (08:00–01:00 Cairo) into the camera Drive folder. Reports are JSON in the «تقارير» Drive folder, drawn by the dashboard (التقارير). Recipe: `tools/camera-day-report.md`; skill copy: `tools/skills/elsousy-camera-report/SKILL.md`.
- Dashboard shows a red dot on the server-refresh button when a server update or the version limit needs attention.

## Camera reports: how they run
**Status:** current recipe = `tools/camera-day-report.md` (what the tasks run). The redesign (all inside frames, outside every 30 min, 4×3 grids, midnight run split in two) is staged in `tools/camera-day-report-next.md`, **not active**: Ahmed wants the current tasks/settings kept until his usage renews. Activate by copying `-next` over the active file.
Historical Claude routines were «تقرير الكاميرات — الضهر» 12:04 and «— الليل» 00:04 Cairo. Their external status is not available here; Ahmed was told to pause them if still active to avoid duplicates. The older single-frame task «تقرير الكاميرات التلقائي» (10:36 / 22:36) should also be paused. See the current three ChatGPT schedules below.

## Manual entrance/counter-video probe (2026-11-01)
- Security prerequisite: removed the fixed WhatsApp verification-token fallback from module 21; missing `WA_VERIFY` is now generated randomly in Script Properties. Existing saved values are preserved. Worker code is unchanged.
- Settings → Cameras: separate one-minute entrance and counter buttons; one player at a time. Authenticated POST `camVideoTest` only; uses existing server-side credentials, allows only recorder channels **4 (entrance)** and **3 (counter)** after exact serial/channel resource discovery.
- New source: `server/src/66_cam_video.js`. Requests live **fluent/sub-stream** HLS, then checks EZOPEN availability if no HTTPS HLS address is available. Fluent does **not** imply a fixed 256 kbps bitrate.
- HLS signed playback URL goes only to the authenticated owner's browser in memory; API key, secret, SDK tokens and raw provider errors never return. No links/tokens in logs, reports, GitHub, local storage or messages. No encryption settings are changed.
- Native HLS browsers (e.g. Safari on iPhone) can attempt playback. Client stops after 60 seconds, on explicit stop, page hide or removal of the player. Other browsers get an honest unsupported-player message. An address alone is **not** verified playback, connection stability, bandwidth measurement or AI accuracy. EZOPEN requires the official SDK; this probe does not integrate it.
- Counter response channel is checked by the client, so an older server cannot silently show entrance video for a counter request. Invalid channels are rejected before provider access.
- No live account test has been performed from the coding environment (no admin PIN/session). After server update, Ahmed runs the button and shares **only the visible status/error code**, never a playback URL or token. Existing snapshot schedule and report recipe remain active as before.
- Validation: `node tools/test-camera-video.js`, server build/check + JS syntax. Browser playback was not tested here: Chromium is absent and its download failed. Ahmed confirmed entrance video played on his phone (2026-11-01); Ahmed also confirmed counter playback; analysis accuracy remains pending.

## Manual private video samples (2026-11-01)
- `server/src/66_cam_record.js`: PIN-protected POST `camRecordSample`, numeric channel 3 or 4 only. Separate settings buttons, one recording at a time via a six-minute property lease; owner lock held briefly only to acquire/release lease. Video IO never holds the general script lock. `camRecordPilot` is an editor-only manual two-camera run, never a scheduled trigger.
- Collects approximately 20 seconds (up to <30 with segment boundaries), at most 8 MiB of media, 24 polls / 45s polling budget. Apps Script network calls themselves have provider/platform timeouts. No all-day recorder or AI/counting is installed.
- HLS master chooses lowest advertised bandwidth; public HTTPS media references only, provider-directed redirects may go to public HTTPS CDN endpoints (maximum 3 hops), without forwarding API headers; final playlist URL becomes the relative-media base. Private/LAN/HTTP redirect targets are rejected. Encrypted, byte-range, gap/discontinuity, unsupported media fail explicitly without changing encryption. TS or fMP4 media plus local-only playlist and sanitized metadata are stored as ZIP. Download/FFmpeg decoding must succeed before claiming usable video.
- Creates a separate root Drive folder «عينات فيديو الكاميرات — خاص», stored in `CAM_SAMPLE_FOLDER`; checks private sharing and no viewers/editors. Never uses snapshot/report sharing. No provider URL, auth token or key is written to the archive/logs/dashboard. The ZIP is not directly playable MP4.
- Metadata has server collection timestamps, not verified camera event time. Review requires enough visible activity; a short or empty sample cannot establish counting/wait-time accuracy. User authorized capture and private Drive storage; no third-party AI service is connected.

## Live recording checkpoint (2026-11-01)
- Both manual video players confirmed working by Ahmed. Live recording has **not succeeded**: samples folder exists and connector confirms `shared: false`, but Google server fetching HLS playlist failed for channels 4 and 3; no usable recording saved or reviewed.
- Initial global-lock contention corrected by owner lease. Initial URL validation corrected for public IPv4 and explicit HTTPS ports. Latest recorder adds sanitized HTTP status and bounded same-origin redirects for diagnosis; tests are offline and are not evidence of live capture success.
- Cleanup completed after explicit final confirmation: deleted 100 versions **145–244**, then 79 versions **245–323**. Verified **21 versions** remained (latest 20, 324–343, plus the older active deployment). New deployments add versions normally; old active deployments were untouched. Do not equate editor update completion with successful deployment.
- Live fetch diagnosis reached `origin` at playlist loading: Hikvision redirects to another video endpoint. Current fix revalidates the public HTTPS CDN destination and preserves final URL for relative segment paths; never forwards API auth headers or the original query across origins. Live re-test reached playlist parsing for both channels but stopped safely with `stage: playlist, code: format`; no ZIP or playable sample saved. A successful HLS fetch is not a successful recording. Ahmed asked to conserve usage; pause further implementation/testing here.

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


## Resume point — recording pilot paused to conserve usage
- Version cleanup is complete: 179 versions 145–323 deleted with action-time consent; 21 remained before subsequent legitimate deployments.
- Latest recorder commit at this checkpoint: `fde6bd6edd8b13a14b99563ed380574bfb61a609`. Apps Script initially fetched stale main content. To install the exact tested build, temporarily replaced `SERVER_SRC_URL` in the editor with this commit's raw URL and ran `serverUpdate`; the fetched bundle restores the normal main URL. Reloaded editor and verified `camRecResolve_` exists before running `camRecordPilot`.
- Latest real pilot: camera 4 AND camera 3 both returned `ok: false, stage: playlist, code: format`. No video was recorded/reviewed and no counting accuracy established. Provider playlist fetch now reaches parser; inspect only sanitized tag/format metadata next (never log signed URLs or tokens) before adding format support. Do not keep repeating generic live tests.
- Private Drive sample folder was created and verified unshared, and remained empty at the last connector check. User says to watch usage limit; stop here and resume efficiently when requested.

## Three camera reports scheduled here (2026-11-02)
- Ahmed chose to KEEP capture every 10 minutes for cameras 1,2,3,4,6. Do not apply proposed 20-second/alternating capture or resume video work.
- Three enabled ChatGPT scheduled reports, timezone explicitly Africa/Cairo, flexible runs within roughly one hour of the target (chosen defaults, not exact user-specified clock times):
  - Noon target 12:10, window today's 08:00 <= t < 12:00; label من 8 ص إلى 12 ظ, report date today, time 1200. Task 6ae7b54e7900819192272227e2d68a3c.
  - Evening target 18:10, window today's 12:00 <= t < 18:00; label من 12 ظ إلى 6 م, report date today, time 1800. Task 6ae7b56c52ac819187615c35adc968a5.
  - Close target 01:10, window yesterday 18:00 through today 00:59; read TWO day folders. Business/report date yesterday, time 2359 for existing dashboard compatibility, label من 6 م إلى 1 ص; visible range must include both dates. Task 6ae7b59409e08191b3c3884544711967.
- Active recipe now defines the three authorized time windows and period-based titles and references tools/camera-appearance-kpi.md. Scheduled prompts are updated to read this rubric, compare previous evidence and populate the assessment schema. Sparse hourly inside / every-three-hours outside sampling, bounded activity extras, grids plus original 2x zoom, JSON v2 and no Telegram/WhatsApp remain in effect. Do not activate -next.
- Every report must show actual preparation timestamp in Cairo time, covered start/end and dates, source-frame timestamp and camera number, image count and limitations. Source timestamps use Drive folder/filename, never the incorrect DVR overlay. Store generatedAt/windowStart/windowEnd with true offsets and readable timestamp in note so it is visible in the existing dashboard.
- Save reports to existing Drive reports folder and verify save. Same-task same-window reruns skip an already complete report; different legacy reports use recipe suffix to avoid overwriting. Connected Drive reports folder was successfully read before scheduling; future execution and successful report output have NOT yet been demonstrated.
- No camera/report task existed among this account's scheduled ChatGPT tasks before creation; unrelated personal tasks were not touched. External Claude schedules cannot be paused through these task controls; Ahmed was explicitly informed.

## Home appearance assessment (2026-11-02)
- User approved implementing the mobile Home design. New `camera-assessment.js` is pure shared calculation code; `index.html` renders the real latest report assessment, six category scores, coverage, current issue states and comparable previous-period delta. No example scores are inserted into live reports or Home. Legacy reports show no score.
- Rubric `appearance-v1`: cleanliness 25, counter/desk 25, access 20, medicines 10 and diapers 10 (both camera 2), condition/display 10. Ten fixed zones and evidence rules are specified in `tools/camera-appearance-kpi.md`; active report recipe references it. Clothing excluded. Grade latest clear observations near period end, not cumulative problems over periods of unequal length. Evidence older than 90 minutes before window end is excluded. Unknown areas are excluded with explicit coverage; percentages normalize only over observed weights.
- Comparison requires previousReportId, same rubric, older window and same evaluated zones; unresolved/missing previous issues become unverified instead of resolved. Resolved problems require clear current evidence, high confidence, same zone and explicit comparisonVerified. Deduplicate stable issue IDs; deductions 1/3/5 cap at zone weight and do not accumulate across periods. Photos and JSON are still reviewed/saved by the scheduled assistant; Home does not itself infer vision or run an AI model.
- Report titles use covered periods; preparation timestamps remain visible separately. Header/report views prefer window timestamps/range. Home no longer eagerly downloads all report images just to display scores (saves bandwidth). Source capture schedule and video code untouched; no Apps Script deployment needed for this frontend/schema change. Existing camReports endpoint returns added JSON fields.
- New Home action «طلب تحليل من الشات» prepares/copies a request and opens ChatGPT for the owner to send. It explicitly does NOT trigger autonomous instant analysis. Existing Gemini credentials were observed by source references only, never read. Enabling paid/direct Gemini camera-image analysis was NOT authorized or activated; explain this separately if requested.
- Run `node tools/test-camera-assessment.js` and parse dashboard scripts. Scored live output is pending the first new evidence-backed report; do not claim the demonstration score is real. Existing external Claude routines still require owner pause if active.



## Camera UI and missing-window recovery (2026-11-02)
- Three camera automations now check actual saved windows since 1 Nov 2026 and prepare missing completed periods oldest first. A run/no_update is not proof of a saved report. Check again before saving to avoid duplicates; report remaining backlog/failures explicitly. Capture cadence, sampling recipe and schedules unchanged.
- Home/report UI commit 219db91097bd702eda7a4af71265da710f118d63: keep last loaded appearance card visible on redraw; share in-flight report fetches, RAM cache 5 minutes, explicit refresh bypass, preserve last result on network failure. No evidence images load just to display Home.
- Report coverage now lists all five cameras 1/2/3/4/6 from reviewedFrames, separately from annotated pages. Latest reviewed original for each camera opens on demand. Blue means reviewed, amber means evidence annotations, gray means unavailable coverage; no inferred all-clear from absent pages. Legacy coverage remains explicitly unknown when not recorded.
- Report pages show progressively with two workers: original first, repeats then redraw. Guard against responses writing into a newer report. Loading progress/retry visible; PDF waits for successful page and repeat loading. PDF summary text wraps and preserves full scope note; HTML has readable findings and review scope.
- Validation: dashboard JS syntax, 15 appearance checks, server bundle check, real-report coverage (5 reviewed / 3 annotated cameras), shared/cached/forced/offline fetch behavior and progressive-render/PDF completion checks passed. Visual iPhone/browser rendering not verified: no local Chromium executable. No backend update required.

- Follow-up b51c61f: Home now restores the last successful report metadata via existing 24-hour local cache when a saved owner PIN exists, labels restored data while checking for updates, and starts camera metadata loading independently of the sales bundle. No images/secrets added to cache; failed network refresh preserves saved reports, removed/invalid PIN clears this camera cache. First-ever device load still needs the server; after 12 seconds show an explicit delayed-first-load message. Restore/reload/offline/auth-clearing checks and all 15 appearance tests passed.


## Strict review and PDF export (2026-11-02)
- Ahmed requested stricter camera-image review and a sharing fix. Active `tools/camera-day-report.md` now requires two passes over the SAME selected originals/crops, explicit micro-area checklist and `reviewProtocol:strict-review-2026-11` / `reviewAudit`. No missed minor visible problems, no assumed temporary-use excuses, no invented violations, no grade target. `tools/camera-appearance-kpi.md` requires explicit evidence before a full zone score. Capture, bounded sampling, appearance-v1 weights/deductions and previous-report rules are unchanged. Old reports are not rescored.
- Camera PDF is prepared once AFTER all evidence pages load and BEFORE enabling sharing, so the share tap calls navigator.share directly with the prepared File. Added explicit Download PDF, retry on PDF/CDN error, summary-only export, shared script loading, long-page size limit and stale-report guards. Cancellation does not force a download; failed native sharing offers retry/download. Legacy cover no longer labels unannotated cameras «تمام».
- Validation: dashboard inline JS syntax and mocked export checks passed (preparation before tap, no build during share, download, cancellation, synchronous/asynchronous rejection, unsupported sharing, incomplete images, missing canvas, CDN failure and stale report). No iPhone native share-sheet or real report image QA was performed in this change. No server update required. Stricter prompt is a workflow change, not proof of measured vision accuracy improvement.


## Compact camera inside daily hero + unified periods/expenses (2026-11-02)
- Ahmed approved the preview: camera summary belongs INSIDE the daily sales hero below its KPIs/expenses, not in the pharmacy branding header. Removed standalone Home monitor card. Native details disclosure expands period findings inline; separate «تفاصيل التقرير والصور» opens the latest report. Preserve open state during metadata redraw; include actual period/date, coverage, generation timestamp, explicit cached/legacy/unknown states. No invented scores. Report/snapshot/request-analysis controls remain inside expanded section; no automatic capture or analysis added.
- Current-month / previous-month / yesterday slide now uses the same goal ring, main sales typography and 2-column KPI grid as the daily hero. Calendar month names and completed-day cutoff remain; no change to sales sources or month targets.
- Added recorded expenses to BOTH daily and selected-period heroes from existing getProfitLoss.days[].expenses, with exact matching date bounds. Current month remains through yesterday; daily follows displayed today/yesterday. Excludes inventory purchases consistently with existing P&L; shows recorded operating expense only, without adding daily salary allocations. Unknown source/failure is unavailable rather than zero; stale expense data gets a warning. Month-keyed in-flight requests and 5-minute RAM cache are shared between both cards. No Apps Script source/build/deployment change.
- Validation: all 15 camera assessment checks; full dashboard JS syntax; focused Home VM checks for exact day/month expense boundaries, legitimate zero vs missing data, stale/invalid source, request sharing/retry, year rollover, HTML escaping, disclosure persistence/latest report action, single camera widget inside daily hero and yesterday fallback. Native iPhone layout and live financial data were not tested from this environment.


## Weekly dashboard improvement — 2026-11-02
- Ahmed authorized improving the reviewed dashboard and a recurring weekly review/development task. Schedule: Mondays around 10:00 Asia/Riyadh, first 2026-11-09 (flexible). Preserve the existing camera tasks.
- Product language must be clear, professional Arabic: إغلاق instead of إقفال, إعادة المحاولة, المالية, الرسائل. Keep replies concise Egyptian Arabic. Internal data/status keys are not renamed.
- Read `tools/dashboard-improvement-log.md` for implemented fixes, deployment requirements and remaining priorities. This log is authoritative about scope: financial records are preserved; ledger ambiguity is flagged rather than guessed away.
- Current sales use `getMonthTotalsFromRaw` / pure `rawDay_` aggregation on ALL dates, including today. Home and P&L share this source; today remains provisional. No call to `parseStaffStats` from the aggregate, since it has customer-tracking side effects.
- P&L schema `finance-review-v1` returns null authoritative net when expense sources are unavailable, ledger amounts require reconciliation, or paid salary and accrual settings conflict. `estimated_net_profit` is diagnostic, never an approved financial result. Selected-range UI respects exact dates; recorded totals are not silently rewritten.
- Owner data uses `ownerDashboardLocked_` independently of optional `dashLocked_`; delivery/operational lock behavior is preserved. Owner frontend bypasses legacy Worker reads pending manual secured Worker deployment. Source changes alone do not close the old Worker's public-cache exposure.
- Deploy generated Apps Script and manually deploy `worker/worker.js`, then verify live behavior before claiming protection/dataset consistency. Existing automatic Apps Script updater may install the source if enabled, but that is not verified from code publication alone.
- Validation commands: `node tools/test-dashboard-review.js`, `node tools/test-camera-assessment.js`, `node tools/build-server.js --check`, `node --check server/Code.js`.


## Dashboard visual refinement — 2026-11-02
- Ahmed explicitly authorized implementing the reviewed visual improvements, updating Cloudflare and adding visual QA to the existing weekly task. Weekly schedule is unchanged; its prompt now includes typography/contrast, card/control consistency, top period selector, camera placement, top-three actions, sign-in/loading/error states and iPhone QA.
- Frontend-only changes: `dashboard-ui.css` overrides shared presentation tokens/components for both themes; period selector is above Home's hero, forecast is collapsed, and primary/async action rows share one priority-sorted top-three list. Camera summary remains inside the daily hero. Financial calculations and data fields are unchanged.
- Correctly distinguish origin lock responses from network failure using `AUTH_REQUIRED`. A protected page shows an explicit sign-in card after the existing PIN prompt is cancelled. No PIN, session secret or production data is embedded. Existing owner PIN validation remains at the server.
- Desktop card layout uses a two-column grid instead of CSS newspaper columns; mobile keeps a single column. Controls target at least 44px and task controls support Enter/Space. Keep the new stylesheet loaded after legacy styles.
- Cloudflare integration still was not exposed to this conversation; browser remained on the Cloudflare sign-in page at preparation time. Do not claim its Worker is updated without a verified deployment. Origin Apps Script protection was observed after Ahmed updated the server; protected numeric consistency still requires authenticated QA.
- No server build/deployment is needed for this visual change. Existing dashboard/appearance checks remain relevant; live private Home and native iPhone touch/sharing have not been verified by these checks.


## Cloudflare deployment verified — 2026-11-02
- Cloudflare plugin connected to the pharmacy account; native API deployment is now available (read skill before API use). Worker `wispy-cloud-00a7` was deployed from the current repository's `worker/worker.js`, blob `26608f781e60ab9e048de39aa1ed898a8cc5d6e0`.
- Active version `a1bef510-721f-4034-b884-73994a8b270f` serves 100% of traffic; deployment `6efcc92f-e90f-4543-b68e-80f2979c8285`. Retained compatibility date/flags and other existing settings; previous version `02625f78-80d4-495c-95d1-53492d11fccf` is available for rollback.
- Fixed accidental leading whitespace in the existing D1 binding name to exactly `DB`, retaining the same database. Read-only schema verification confirmed existing `c(k,body,at,ref)` cache table; no rows were read or changed by the verification.
- Enabled `observability.redact_query_string` to avoid persisting credential-bearing query strings in invocation URLs.
- Live browser checks: `?action=ping` returned `ok:true, fast:true, db:true`; `?action=getProfitLoss` without a PIN returned `ok:false, lockError:true`, with no financial data. Executor HTTP checks were blocked; browser checks are the live evidence. Existing 20 dashboard/Worker checks passed.
- Cloudflare deployment is no longer pending. Authenticated live numerical parity/cache performance remains unverified without an owner login. Frontend `FAST_READ` remains bypassed pending that verification; do not claim dashboard acceleration is re-enabled. Camera/video/delivery behavior was not changed.


## Expense display, reload and custom-period repair — 2026-11-02
- Ahmed reported incorrect expenses, repeated loading, and the missing three-dot period picker on the Home month card. Fixed frontend only; no Apps Script/Worker deployment or financial record edits are required.
- Home expenses now explicitly display itemized operating payments including salaries, excluding stock purchases AND synthetic `fromLedger` top-ups. Unitemized ledger differences appear separately pending reconciliation. This does not establish whether a difference is missing detail or a duplicate salary; do not infer that from equal amounts. Missing source/schema/unknown per-day remainder is unavailable rather than zero. The expenses page uses the same itemized/uncertain separation, and category detail uses the same itemized rows as its headline.
- Persist owner-only Home P&L aggregates and all period summaries for up to 24h; reuse fresh results for 5 minutes; share in-flight loads. Daily hero restores its expense row before requesting an update. Failed refresh preserves the last amount with a warning. Financial performance reuses this P&L cache. Expense-page data also avoids redundant requests while fresh. Explicit Refresh invalidates relevant freshness/caches. No photos, customer records or credential values are added to these caches.
- Home period selector includes visible `⋯` with accessible label `تحديد مدة التقرير`, including while loading or empty. Custom from/to dates support cross-month and cross-year ranges through today, at most 366 inclusive days; reject invalid/reversed/future/oversized ranges. Sales and expense dates match exactly. Multi-month expense inputs are merged, and custom targets use inclusive selected days. Selection survives reload within the session.
- Checks: `node tools/test-expense-period-ui.js` (15 focused cases), existing 20 dashboard checks and 15 camera checks. The performance test fixture now supplies its extracted renderer's shared P&L-cache dependency. Actual private expense reconciliation and iPhone behavior still need authenticated verification.


## Neutral dark appearance — 2026-11-02
- Ahmed explicitly rejected the blue-tinted dark background and requested a luxurious, refined dark appearance. Dark theme uses neutral black/charcoal/graphite surfaces, warm off-white text, subdued borders and restrained champagne accents. Keep blue out of large dark surfaces; retain semantic status colors and the pharmacy logo.
- Light-theme tokens are unchanged. No financial logic, staff mapping, periods, camera/report settings or records changed. Stylesheet version bumped to refresh the appearance immediately. Validate contrast and loaded colors; this is a presentation-only change.



## Blue text accents and collapsible report notes — 2026-11-02
- Ahmed prefers the neutral charcoal background with blue text/interaction accents rather than champagne/brown. Keep dark surfaces neutral; light-theme tokens and semantic red/amber/green statuses remain unchanged.
- Home daily/month expense explanatory notes (saved data, refresh state, unitemized differences, delayed source) are collapsed by default under native `حالة البيانات` details. Saved-data label and a small status dot stay visible; substantive unknown/net-under-review values remain visible. The explanatory text is available on tap and uses neutral secondary text. Open state survives Home redraws, separately per covered date range. Retry remains inside its status disclosure.
- No expense amount, date selection, cache policy, camera assessment or backend changes. Updated stylesheet URL busts the old accent cache.


## Closing cash classification and cache repair — 2026-11-02
- Closing review v2 no longer treats decreases in debt balances as cash receipts. Keep raw_collections as an unclassified diagnostic; cash collection and expected drawer come only from the POS daily-closing PDF. Unknown values stay null. expected_cash excludes an explicitly known custody amount; expected_drawer_total includes custody and uses the PDF drawer system value, preserving any recorded expenses/adjustments.
- Raw invoice payment totals remain unchanged and differences against the POS PDF remain visible. Do not infer transfers or force a claimed difference; actual counted drawer/card differences are separate from source reconciliation.
- Raw export cache validates file ID/update time/size; PDF cache CLP2 validates daily AND shift files, selects newest daily PDF, and rereads updated files. Legacy CLP/close1 values cannot silently keep an obsolete result.
- Frontend and exported closing PDF label cash receipts, custody inclusion and unknown amounts explicitly; older server responses show unavailable cash calculation and request server update. No financial records, POS inputs or delivery data are modified.
- Run tools/test-closing-review.js, build/check server bundle and dashboard syntax/review tests. Server update/deployment is required; publishing GitHub alone does not establish the live server is running v2. The owner's reported 500 difference has not been corroborated by the available Nov 1 closing PDF; no invented adjustment is inserted.


## Home expense loading repair — 2026-11-02
- Home daily/period expense rows use existing protected getExpensesData with explicit month bounds, independently of the expensive getProfitLoss pipeline (which reads sales/profit for the whole month). Financial P&L still uses its original source; expense-only aggregates never enter HOME_PL_CACHE.
- Aggregate only operating/salary entries by date, excluding purchases/income; preserve synthetic ledger remainder separately. Store aggregate-only homeExpense.v1 for 24 hours (no names/details); reuse for 5 minutes and share requests. Restore previous compatible P&L expense cache when available. No source or unknown amount is represented as zero.
- Home expense request has a 25-second UI deadline, a 60-second automatic retry backoff, explicit retry bypass and late-success persistence/display. Failure keeps saved amounts. A late response after owner sign-out/PIN change cannot populate cache. Start daily expense loading immediately after Home DOM, before optional widgets.
- Explicit Refresh invalidates the new aggregate cache/failure backoff. Backend/camera/delivery/financial record behavior is unchanged; no server update required.
- Validation: tools/test-home-expense-loading.js covers lean endpoint, date bounds, request sharing, amount/remainder/exclusions, persistence, timeout/redraw/retry, late response and sign-out; tools/test-expense-period-ui.js has 16 cases, dashboard script syntax passed. Actual owner's private live latency is unverified without owner sign-in.


## Minimal expense footer — 2026-11-02
- Ahmed requested removing explanatory text below Home expenses. Daily and period expense rows now show only a small neutral «آخر تحديث» footer, using the actual cached aggregate _uiAt in Cairo time (date and time). Missing timestamps display a dash, never the current time. Removed the operating/stock subtitle and expense-status prose/disclosure. On failure, retain the saved amount/timestamp and provide a plain retry button. Calculations, pending-ledger separation and loading/cache behavior are unchanged.


## Two daily insight cards — 2026-11-02
- Ahmed requested expenses and cameras side by side INSIDE today's hero, each showing its own last-update timestamp and opening details on tap. Implemented two equal grid columns with semantic buttons, aria-expanded/controls and one full-width detail panel below the pair. Opening one closes the other; active panel survives async redraws. Missing camera/report states retain the same card layout and do not invent a score or timestamp.
- Expense card shows itemized operating/salary total; details include available category sums, pending unitemized difference and navigation to Expenses. Aggregate-only category/day sums are retained without names or item detail. Legacy cached aggregates still show total and an Expenses link until refreshed. Monthly card keeps its minimal last-update footer.
- Camera card shows the actual report score or a dash and generatedAt as its last update (not metadata refresh time). Coverage, covered period, findings and report/image controls are inside the expanded panel. Camera capture and analysis schedules are unchanged.
- The owner also requested the top amount to be net. Main hero already uses canonical net_sales (sales minus returns); retain the explicit «صافي المبيعات» label. He did not answer the net-profit-versus-net-sales clarification; no profit-after-expense number is substituted by assumption.
- Frontend only; no server deployment required. Home expense loading/interaction checks, 16 expense-period checks, 15 camera assessment checks and dashboard JavaScript syntax passed. Actual native iPhone/private-data layout is not verified from these mocked checks.


## Camera refresh feedback and Cairo attendance — 2026-11-02
- Verified the evening camera automation last recorded no_update and the reports folder still had no new 1800 report; Ahmed explicitly confirmed the usage limit had been exhausted. Do not invent a newly generated report or claim the refresh button analyzes images.
- Renamed Home's camera refresh control to «تحديث قائمة التقارير». Forced refresh reports whether an actual newer saved report was found; missing owner access gets explicit feedback. Actual report generatedAt remains the update timestamp. Existing camera schedules/capture recipe are unchanged.
- Team page now has an explicit «دخول وخروج الفريق» attendance section from the existing getStaffHub.rows, including staff without POS sales. Times are already formatted Africa/Cairo by the server, relabeled as Cairo and AM/PM localized; do not shift them again. Employee shift details and attendance exports explicitly label Cairo time.
- Home shows each live employee's actual check-in timestamp formatted via Intl Africa/Cairo, independently of the owner's phone timezone, alongside elapsed duration and a link to the full in/out record. Missing clock-out is «لم يسجل الخروج», never an invented departure. Existing server/API calls and payroll records are unchanged.
- Frontend only; no server update required. Tests: tools/test-staff-cairo.js covers epoch seconds/milliseconds, winter/summer offsets, missing input and escaping. tools/test-camera-refresh-feedback.js covers unchanged/new report and missing-owner feedback; 15 camera assessment checks and dashboard JS syntax passed. Actual private attendance values and live owner latency remain unverified without owner access.
