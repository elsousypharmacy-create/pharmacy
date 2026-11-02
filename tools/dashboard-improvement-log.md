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
