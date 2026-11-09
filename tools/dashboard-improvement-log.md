# Dashboard improvement log

## 2026-11-02 — reliability, clarity and owner-data protection

Authorized by Ahmed after the full dashboard review. Weekly review task enabled for Mondays around 10:00 Asia/Riyadh, first run 2026-11-09. Do not assume that a scheduled run completed or published; verify results.

### Implemented in source
- Invoice-based sales aggregates for current and completed dates, shared by Home, performance and P&L. A pure parser avoids customer-tracking side effects. Missing invoice dates and provisional current-day numbers are explicit.
- P&L follows the selected date range, including multi-month ranges. Delayed responses cannot overwrite a newly selected performance tab.
- Ledger top-ups remain in source totals but are marked for reconciliation. Missing expense sources or concurrent paid salaries/allowances withhold an authoritative net profit. No accounting records or salary settings are changed.
- Operating payments and inventory purchases are separately labelled; budget totals are provisional when mandatory inputs are missing.
- Messages default to all messages; failure filters are visible with accurate empty states. SMS actions require a successful API result before displaying success.
- Home period buttons, month progress through completed days, explicit full-day comparison, provisional forecast label, more readable small labels, and current-day closing status.
- Standard Arabic product labels, including إغلاق, إعادة المحاولة, المالية and الرسائل. Staff pages calls.html and expenses.html receive the same core wording. Delivery files are unchanged.
- Low-sample staff scores are withheld under 20 invoices. Duplicate doctor codes are grouped in the display with a warning, while records remain untouched.
- Origin owner-data reads always require the existing owner PIN, independently of the legacy operational lock. Doctor administration is protected. Separate delivery/operational lock behavior is preserved.
- Owner frontend reads bypass the legacy Worker cache. Updated Worker source validates current authorization before serving protected cached responses, including after PIN revocation.

### Deployment requirements and limits
- GitHub Pages serves the changed frontend after its build completes.
- Apps Script must deploy generated server/Code.js (dashboard server-update action or existing enabled updater). Code publication alone does not prove live deployment.
- Cloudflare Worker is deployed manually by the owner; repository publication does not update that external Worker. Old Worker endpoints can retain public cached data until the secured Worker is deployed. Do not claim security completion before this step is verified.
- Existing staff endpoints retain their established behavior. This is not a complete role-based access/session redesign.
- Browser and iPhone testing remain separate from Node mock checks. No live camera-analysis accuracy or accounting reconciliation is claimed.

### Checks
- node tools/test-dashboard-review.js: source consistency, date ranges, uncertain expenses/salaries, failed source, origin authorization, operational lock compatibility, selected-range P&L, Worker cache authorization, and JS syntax.
- node tools/test-camera-assessment.js: existing 15 rubric/evidence checks; two copy assertions updated for the requested terminology.
- node tools/build-server.js --check; node --check server/Code.js.

### Next work, in order
1. Verify live origin/Worker deployments and authenticated access; then reconcile source invoices, closing totals and the expense ledger using actual records. Do not infer that matching amounts alone prove duplicate expenses.
2. Design individual owner/staff sessions and permissions without disrupting operational pages. Remove long-lived PIN-in-URL reliance as part of that design.
3. Add assigned owners, due dates and status history to dashboard tasks using existing operational data where available. No fabricated task completion.
4. Improve staff identity matching with explicit ID mappings and compare equivalent shifts.
5. Improve shortage priority by demand and lead time, expiry return tracking, and stocktake coverage; keep delivery unchanged.
6. Measure customer follow-up outcomes and refine incomplete medicine-search aggregation; retain original audit history.
7. Add camera missing-window and stale-report status based on saved report evidence; preserve capture/report schedules and paused video work.
8. Test touch, native sharing, contrast and layout on iPhone. Re-enable accelerated protected reads only after the Worker authorization path is verified.


## 2026-11-02 — visual refinement follow-up
- Added the visual review to the existing weekly task without changing its schedule or creating a duplicate task.
- Shared dark/light design tokens, stronger secondary text contrast, larger small labels, consistent card spacing/radii and period controls, 44px controls, explicit focus states, and desktop grid layout.
- Home's period selector is above the hero; forecast details collapse; synchronous/asynchronous tasks combine into one top-three list with remaining items expandable. Camera assessment stays inside the daily card.
- Clear sign-in card after an origin lock/cancel rather than a generic loading failure. Network failure retains its own retry state. Owner authentication is not bypassed.
- Only presentation and UI state are changed. Original financial calculations, camera schedules, delivery system and operational records remain untouched.
- Validation: dashboard JS syntax and existing 20 dashboard/15 camera checks passed. Authenticated private data views and physical iPhone behavior require separate live verification. Cloudflare deployment remains blocked until an authenticated service connection is available.


## Cloudflare deployment verified — 2026-11-02
- Cloudflare plugin connected to the pharmacy account; native API deployment is now available (read skill before API use). Worker `wispy-cloud-00a7` was deployed from the current repository's `worker/worker.js`, blob `26608f781e60ab9e048de39aa1ed898a8cc5d6e0`.
- Active version `a1bef510-721f-4034-b884-73994a8b270f` serves 100% of traffic; deployment `6efcc92f-e90f-4543-b68e-80f2979c8285`. Retained compatibility date/flags and other existing settings; previous version `02625f78-80d4-495c-95d1-53492d11fccf` is available for rollback.
- Fixed accidental leading whitespace in the existing D1 binding name to exactly `DB`, retaining the same database. Read-only schema verification confirmed existing `c(k,body,at,ref)` cache table; no rows were read or changed by the verification.
- Enabled `observability.redact_query_string` to avoid persisting credential-bearing query strings in invocation URLs.
- Live browser checks: `?action=ping` returned `ok:true, fast:true, db:true`; `?action=getProfitLoss` without a PIN returned `ok:false, lockError:true`, with no financial data. Executor HTTP checks were blocked; browser checks are the live evidence. Existing 20 dashboard/Worker checks passed.
- Cloudflare deployment is no longer pending. Authenticated live numerical parity/cache performance remains unverified without an owner login. Frontend `FAST_READ` remains bypassed pending that verification; do not claim dashboard acceleration is re-enabled. Camera/video/delivery behavior was not changed.

## 2026-11-09 — weekly review, canceled login and safe printing
- Reviewed main 24f40ad and the week's changes, repository instructions and all dashboard areas at source/test level. Full scope, findings and test limits are in tools/reviews/2026-11-09.md.
- Fixed repeat automatic PIN prompts after cancellation, escaped all dynamic PDF table/title text, repaired the iPhone home icon reference, made shared menu rows keyboard-operable and refined retry wording. No financial calculations or records changed.
- Repaired four stale UI regressions and added two focused behavioral/security tests. 18 test files, HTML script syntax, Worker/server syntax and server build consistency checks pass.
- Expanded public synthetic visual fixtures to light/dark and six sizes, including 428x926 and desktop; corrected missing recent Home elements, styles and helper/font dependencies. Fixed short-screen priority clipping by moving the existing NOVA shortcut into the action heading only below 680px available height; pre-activation browser fixture check keeps all three rows inside at all six sizes, without reducing text. Native iPhone and owner-session totals remain unverified.
- Cloudflare active deployment still the verified 2 Nov version; 7 Nov deploy-worker run failed at Deploy. No Worker/Apps Script deployment performed or implied by this frontend publication. Shared offline fallback to the delivery page is documented for coordinated review, not altered here.
